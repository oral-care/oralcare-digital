#!/usr/bin/env bash
# Restores a backup (plan 16.2): the newest weekly backup in the folder, then
# every nightly backup after it. Used for the quarterly restore test into a
# temporary Neon branch, and after a disaster into an empty database. Runs on
# your computer, with the private key, which never leaves it.
#
#   RESTORE_URL=<oc_migrator address of the temporary branch> \
#   AGE_IDENTITY=<the private key file> \
#   scripts/backup/restore.sh <folder with the downloaded backups>
#
# The target's core, availability, auth and drizzle schemas are dropped and
# built again with the migrations, so the script asks you to type the target's
# host first, and it refuses the production database's endpoint. auth is never
# in a backup: an admin invites the users again afterwards.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tables.sh
source "$here/tables.sh"

PRODUCTION_ENDPOINT="ep-curly-water-batm19vs"
folder="${1:?Give the folder with the downloaded backups}"
: "${RESTORE_URL:?Set RESTORE_URL to the oc_migrator address of the temporary branch}"
: "${AGE_IDENTITY:?Set AGE_IDENTITY to the private key file}"

host=$(sed -E 's#^[a-z]+://[^@]*@([^:/?]+).*#\1#' <<< "$RESTORE_URL")
case "$host" in
  *"$PRODUCTION_ENDPOINT"*) echo "That is the production database. Restore into a temporary branch."; exit 1 ;;
esac
read -r -p "Everything in ${host} is replaced. Type the host to go on: " typed
[ "$typed" = "$host" ] || { echo "Not the same host. Nothing was changed."; exit 1; }

# psql and pg_restore verify Neon's certificate with the system's roots.
case "$host" in localhost | 127.0.0.1) pq_url="$RESTORE_URL" ;; *) pq_url="${RESTORE_URL}&sslrootcert=system" ;; esac
target() { psql "$pq_url" -XtAq -v ON_ERROR_STOP=1 "$@"; }
decrypt() { age --decrypt --identity "$AGE_IDENTITY" "$1" | gunzip; }

# The newest weekly backup, and the nightly backups after it, oldest first.
manifests=$(find "$folder" -name manifest.json -print0 | xargs -0 -I{} sh -c 'jq -r --arg d "$(dirname "{}")" "[.kind, .point, \$d] | @tsv" "{}"' | sort -k2)
weekly=$(awk -F'\t' '$1 == "weekly" { d = $3; p = $2 } END { print d }' <<< "$manifests")
[ -n "$weekly" ] || { echo "No weekly backup in ${folder}."; exit 1; }
weekly_point=$(jq -r .point "$weekly/manifest.json")
nightlies=$(awk -F'\t' -v w="$weekly_point" '$1 == "nightly" && $2 > w { print $3 }' <<< "$manifests")
newest_nightly=$(tail -n 1 <<< "$nightlies")

echo "Building the schemas with the migrations."
target -c "DROP SCHEMA IF EXISTS core, availability, auth, drizzle CASCADE"
DATABASE_URL_MIGRATOR="$RESTORE_URL" pnpm --silent run db:migrate
tables=$(target -c "SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
                    FROM pg_catalog.pg_tables WHERE schemaname IN ('core', 'availability')")
target -c "TRUNCATE $tables CASCADE"

if [ -z "$newest_nightly" ]; then
  echo "Reading in the weekly backup from $weekly_point."
  decrypt "$weekly/weekly.dump.gz.age" | pg_restore --data-only --exit-on-error --no-owner --dbname="$pq_url"
else
  echo "Reading in the small tables from the nightly backup $(jq -r .point "$newest_nightly/manifest.json")."
  for table in "${SMALL_TABLES[@]}"; do
    decrypt "$newest_nightly/$table.copy.gz.age" | target -c "COPY $table FROM STDIN"
  done
  echo "Reading in the growing tables from the weekly backup from $weekly_point."
  selected=()
  for entry in "${APPEND_TABLES[@]}"; do selected+=(--table="$(cut -d. -f2 <<< "${entry%%:*}")"); done
  decrypt "$weekly/weekly.dump.gz.age" |
    pg_restore --data-only --exit-on-error --no-owner --schema=availability "${selected[@]}" --dbname="$pq_url"
  while IFS= read -r nightly; do
    [ -n "$nightly" ] || continue
    echo "Adding the rows from the nightly backup $(jq -r .point "$nightly/manifest.json")."
    for entry in "${APPEND_TABLES[@]}"; do
      table="${entry%%:*}"
      decrypt "$nightly/$table.copy.gz.age" | target -c "COPY $table FROM STDIN"
    done
  done <<< "$nightlies"
fi

target -c "$IDENTITY_SQL"
echo "Done. The latest measurement in the restored copy:"
target -c "SELECT schedule_point, finished_at FROM core.job_run
           WHERE job = 'availability' AND status = 'succeeded' ORDER BY id DESC LIMIT 1"
