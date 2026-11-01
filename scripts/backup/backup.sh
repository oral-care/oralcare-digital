#!/usr/bin/env bash
# The backup (plan 16.2), run by backup.yml as oc_backup against Neon's
# non-pooled address. KIND=nightly copies the small tables whole and the rows
# added to the growing tables since the last backup; KIND=weekly takes all of
# core and availability with pg_dump. Every stream is split with tee: one part
# is encrypted with age to a file before anything reaches the disk, the other
# is read into an empty copy of the database (scratch.ts) with the real
# constraints. The files are kept only if that check passes. The run log gets
# the result and the uncompressed size, which is what Neon counts as traffic.
#
# Needs: KIND, DATABASE_URL_BACKUP, SCRATCH_URL, OUT, POINT, CODE_VERSION, and
# SSL_ROOT=system against Neon so the client verifies its certificate.
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tables.sh
source "$here/tables.sh"

key="$here/backup-key.pub"
if ! grep -q '^age1' "$key" 2>/dev/null; then
  echo "The backup's public key is missing: create it with age-keygen and add it as $key."
  exit 1
fi

source_db="${DATABASE_URL_BACKUP}${SSL_ROOT:+&sslrootcert=$SSL_ROOT}"
q() { psql "$source_db" -XtAq -v ON_ERROR_STOP=1 -c "$1"; }
scratch() { psql "$SCRATCH_URL" -XtAq -v ON_ERROR_STOP=1 "$@"; }
# Whole seconds, which every date command can give.
now_ms() { echo $(( $(date +%s) * 1000 )); }
started=$(now_ms)
mkdir -p "$OUT"
bytes_file="$(mktemp)"
: > "$bytes_file"

encrypt() { gzip -6 | age --encrypt --recipients-file "$key" --output "$1"; }

# Sends stdin to the encrypted file $1 and to the command after it, and counts
# the bytes for the run log. Waits for every part, so any failure stops the backup.
split_stream() {
  local out="$1"; shift
  local dir; dir=$(mktemp -d)
  mkfifo "$dir/encrypt" "$dir/count"
  encrypt "$out" < "$dir/encrypt" & local encrypting=$!
  wc -c < "$dir/count" > "$dir/bytes" & local counting=$!
  tee "$dir/encrypt" "$dir/count" | "$@"
  wait "$encrypting"
  wait "$counting"
  cat "$dir/bytes" >> "$bytes_file"
  rm -rf "$dir"
}

# The run log, like the lock in plan 7: a crashed backup's row is ended first.
q "UPDATE core.job_run SET status = 'failed', finished_at = now(), error_codes = array['lease_expired']
   WHERE job = 'backup' AND status = 'running' AND lease_until < now()"
run_id=$(q "INSERT INTO core.job_run (job, schedule_point, status, lease_until, code_version, schema_version)
            VALUES ('backup', '$POINT', 'running', now() + interval '1 hour', '${CODE_VERSION::12}',
                    (SELECT schema_version FROM core.schema_state)) RETURNING id")
step="start"
fail() {
  q "UPDATE core.job_run SET status = 'failed', finished_at = now(), error_codes = array['backup_${KIND}:${step}'],
       duration_ms = $(( $(now_ms) - started )) WHERE id = $run_id" || true
  echo "The ${KIND} backup failed at: ${step}."
}
trap fail ERR

marks="{}"
if [ "$KIND" = "nightly" ]; then
  # Rows after the last backup's highest ids, up to the highest ids now.
  previous=$(q "SELECT coalesce(details->'marks', '{}') FROM core.job_run
                WHERE job = 'backup' AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1")
  previous=${previous:-"{}"}

  step="small tables"
  for table in "${SMALL_TABLES[@]}"; do
    q "COPY $table TO STDOUT" | split_stream "$OUT/$table.copy.gz.age" scratch -c "COPY $table FROM STDIN"
  done

  step="growing tables"
  for entry in "${APPEND_TABLES[@]}"; do
    table="${entry%%:*}"; column="${entry##*:}"
    from=$(jq -r --arg t "$table" '.[$t] // 0' <<< "$previous")
    to=$(q "SELECT coalesce(max($column), 0) FROM $table")
    q "COPY (SELECT * FROM $table WHERE $column > $from AND $column <= $to ORDER BY $column) TO STDOUT" |
      split_stream "$OUT/$table.copy.gz.age" scratch -c "COPY $table FROM STDIN"
    marks=$(jq -c --arg t "$table" --argjson v "$to" '. + {($t): $v}' <<< "$marks")
  done

  step="check against the run log"
  [ "$(scratch -c "SELECT count(*) FROM core.job_run WHERE id = $run_id")" = "1" ]
else
  step="pg_dump"
  # Checked against the run log: the restored copy must have this run's row
  # and the same latest measurement as the database had.
  latest=$(q "SELECT coalesce(max(id), 0) FROM core.job_run WHERE job = 'availability' AND status = 'succeeded'")
  pg_dump "$source_db" --data-only --format=custom --compress=0 --no-owner --no-privileges \
      --schema=core --schema=availability |
    split_stream "$OUT/weekly.dump.gz.age" pg_restore --data-only --exit-on-error --no-owner --dbname="$SCRATCH_URL"

  step="check against the run log"
  [ "$(scratch -c "SELECT count(*) FROM core.job_run WHERE id = $run_id")" = "1" ]
  [ "$(scratch -c "SELECT coalesce(max(id), 0) FROM core.job_run WHERE job = 'availability' AND status = 'succeeded'")" = "$latest" ]
  for entry in "${APPEND_TABLES[@]}"; do
    table="${entry%%:*}"; column="${entry##*:}"
    marks=$(jq -c --arg t "$table" --argjson v "$(scratch -c "SELECT coalesce(max($column), 0) FROM $table")" \
      '. + {($t): $v}' <<< "$marks")
  done
fi

step="identity sequences"
scratch -c "$IDENTITY_SQL"

step="finish"
bytes=$(awk '{ s += $1 } END { print s + 0 }' "$bytes_file")
jq -n --arg kind "$KIND" --argjson marks "$marks" --argjson bytes "$bytes" --arg point "$POINT" \
  '{kind: $kind, point: $point, marks: $marks, bytes: $bytes}' > "$OUT/manifest.json"
details=$(jq -c '{kind, marks}' "$OUT/manifest.json")
q "UPDATE core.job_run SET status = 'succeeded', finished_at = now(), bytes = $bytes,
     duration_ms = $(( $(now_ms) - started )), details = '$details'::jsonb WHERE id = $run_id"
trap - ERR
echo "The ${KIND} backup is done: $(ls "$OUT" | wc -l) files, ${bytes} bytes before compression."
