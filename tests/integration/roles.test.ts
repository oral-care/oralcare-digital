import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { REQUIRED_SCHEMA } from "@/lib/db/schema-version";

// For every role, which statements go through and which are refused (plan 15.2).

const urls = inject("databaseUrls");
const clients: Partial<Record<keyof typeof urls, Client>> = {};

async function as(role: keyof typeof urls): Promise<Client> {
  const existing = clients[role];
  if (existing) return existing;
  const client = new Client({ connectionString: urls[role] });
  await client.connect();
  clients[role] = client;
  return client;
}

async function allowed(role: keyof typeof urls, sql: string, params: unknown[] = []): Promise<void> {
  const client = await as(role);
  await client.query("BEGIN");
  try {
    await client.query(sql, params);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function refused(role: keyof typeof urls, sql: string, params: unknown[] = []): Promise<void> {
  await expect(allowed(role, sql, params)).rejects.toMatchObject({ code: "42501" });
}

beforeAll(async () => {
  // A user and a clinic to work with, created by the owner.
  const owner = await as("owner");
  await owner.query(
    `INSERT INTO auth.users (id, name, email, first_name, last_name, role)
     VALUES ('admin-1', 'Ada Admin', 'ada@oralcare.se', 'Ada', 'Admin', 'admin')`,
  );
  await owner.query(`INSERT INTO core.clinic (country_id) SELECT id FROM core.country WHERE code = 'se'`);
});

afterAll(async () => {
  await Promise.all(Object.values(clients).map((client) => client?.end()));
});

describe("oc_collector", () => {
  it("reads core and availability, and adds to the registry and run log", async () => {
    await allowed("oc_collector", "SELECT * FROM core.country");
    await allowed("oc_collector", "SELECT * FROM availability.measurement");
    await allowed("oc_collector", "INSERT INTO core.clinic (country_id) VALUES (1)");
    await allowed(
      "oc_collector",
      `INSERT INTO core.job_run (job, status, code_version) VALUES ('availability', 'running', 't')`,
    );
  });

  it("changes only run status, never the job or point", async () => {
    await allowed("oc_collector", "UPDATE core.job_run SET status = 'failed' WHERE false");
    await refused("oc_collector", "UPDATE core.job_run SET job = 'x' WHERE false");
  });

  it("never changes settings or region names", async () => {
    await refused(
      "oc_collector",
      "INSERT INTO core.config_version (key, value) VALUES ('login_paused', 'true')",
    );
    await refused("oc_collector", "UPDATE core.region SET name = 'x' WHERE false");
  });

  it("deletes nothing and never reads auth", async () => {
    await refused("oc_collector", "DELETE FROM core.clinic WHERE false");
    await refused("oc_collector", "DELETE FROM availability.measurement WHERE false");
    await refused("oc_collector", "SELECT * FROM auth.users");
  });

  it("gets only the admins' addresses through the function", async () => {
    const client = await as("oc_collector");
    const result = await client.query<{ admin_emails: string }>("SELECT * FROM core.admin_emails()");
    expect(result.rows.map((row) => Object.values(row)[0])).toEqual(["ada@oralcare.se"]);
    await refused("oc_collector", "SELECT core.prune()");
  });
});

describe("oc_app", () => {
  it("reads and writes auth", async () => {
    await allowed("oc_app", "SELECT * FROM auth.users");
    await allowed("oc_app", "DELETE FROM auth.sessions WHERE false");
  });

  it("never writes measurements, and reads the admins' addresses for the summary", async () => {
    await refused(
      "oc_app",
      `INSERT INTO availability.site_incident (job_run_id, share_missing) VALUES (1, 0.5)`,
    );
    await allowed("oc_app", "SELECT * FROM core.admin_emails()");
    await allowed("oc_app", "UPDATE core.alert SET sent_with = 'summary' WHERE false");
  });

  it("runs the retention function", async () => {
    await allowed("oc_app", "SELECT core.prune()");
  });
});

describe("oc_backup", () => {
  it("reads everything outside auth, including sequences", async () => {
    await allowed("oc_backup", "SELECT * FROM core.job_run");
    await allowed("oc_backup", "SELECT last_value FROM core.job_run_id_seq");
    await refused("oc_backup", "SELECT * FROM auth.users");
  });

  it("logs its own runs and writes nothing else", async () => {
    await allowed(
      "oc_backup",
      `INSERT INTO core.job_run (job, status, code_version) VALUES ('backup', 'succeeded', 't')`,
    );
    await refused("oc_backup", "INSERT INTO core.clinic (country_id) VALUES (1)");
    await refused("oc_backup", "SELECT core.reserve_email('alert', 1)");
  });
});

describe("the database as a whole", () => {
  it("lets no runtime role inherit another role", async () => {
    const owner = await as("owner");
    const result = await owner.query(
      `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
       WHERE r.rolname IN ('oc_migrator', 'oc_collector', 'oc_app', 'oc_backup')`,
    );
    expect(result.rows).toEqual([]);
  });

  it("gives PUBLIC no right to run the functions", async () => {
    const owner = await as("owner");
    const result = await owner.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core' AND has_function_privilege('public', p.oid, 'EXECUTE')`,
    );
    expect(result.rows).toEqual([]);
  });

  it("stops an external account from getting any view but Tracking Framework", async () => {
    const owner = await as("owner");
    await owner.query(
      `INSERT INTO auth.users (id, name, email, first_name, last_name, external)
       VALUES ('ext-1', 'Bea Byrå', 'bea@agency.example', 'Bea', 'Byrå', true)`,
    );
    await owner.query(
      `INSERT INTO auth.user_view (user_id, view, external) VALUES ('ext-1', 'tracking-framework', true)`,
    );
    await expect(
      owner.query(
        `INSERT INTO auth.user_view (user_id, view, external) VALUES ('ext-1', 'availability', true)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      owner.query(`INSERT INTO auth.user_view (user_id, view, external) VALUES ('ext-1', 'nps', false)`),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("refuses overlapping validity periods", async () => {
    const owner = await as("owner");
    // Its own clinic, since other test files share the database.
    const clinic = await owner.query<{ id: number }>(
      `INSERT INTO core.clinic (country_id) SELECT id FROM core.country WHERE code = 'se' RETURNING id`,
    );
    const clinicId = clinic.rows[0]?.id;
    await owner.query(
      `INSERT INTO core.clinic_name (clinic_id, name, city) VALUES ($1, 'Oral Care Test', 'Stockholm')`,
      [clinicId],
    );
    await expect(
      owner.query(
        `INSERT INTO core.clinic_name (clinic_id, name, city) VALUES ($1, 'Oral Care Test 2', 'Stockholm')`,
        [clinicId],
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("is at the schema version the code requires, and still fits the code before it", async () => {
    const owner = await as("owner");
    const result = await owner.query("SELECT schema_version, min_code_schema FROM core.schema_state");
    expect(result.rows).toEqual([{ schema_version: REQUIRED_SCHEMA, min_code_schema: 1 }]);
  });
});

describe("the e-mail quota", () => {
  it("counts per recipient and stops at the cap", async () => {
    const app = await as("oc_app");
    const reserve = async (type: string, count: number) =>
      (await app.query<{ ok: boolean }>("SELECT core.reserve_email($1, $2) AS ok", [type, count])).rows[0]
        ?.ok;
    expect(await reserve("summary", 3)).toBe(true);
    expect(await reserve("summary", 3)).toBe(false);
    expect(await reserve("summary", 2)).toBe(true);
    expect(await reserve("summary", 1)).toBe(false);
    expect(await reserve("unknown", 1)).toBe(false);
  });

  it("never lets two concurrent sends both take the last place", async () => {
    const owner = await as("owner");
    await owner.query(
      `INSERT INTO core.email_send (utc_day, type, count) VALUES ((now() AT TIME ZONE 'UTC')::date, 'invitation', 9)`,
    );
    const first = new Client({ connectionString: urls.oc_app });
    const second = new Client({ connectionString: urls.oc_collector });
    await Promise.all([first.connect(), second.connect()]);
    const results = await Promise.all(
      [first, second].map(
        async (client) =>
          (await client.query<{ ok: boolean }>("SELECT core.reserve_email('invitation', 1) AS ok")).rows[0]
            ?.ok,
      ),
    );
    await Promise.all([first.end(), second.end()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
