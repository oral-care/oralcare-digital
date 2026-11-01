import type { Client } from "pg";

// The database roles' rights as the migrations grant them (plan 10.4). The
// guard compares them with the database every day and alerts on any
// difference, so a right added by hand in the SQL Editor is noticed.

type Privilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";
type Rule = { schema: string; tables: "all" | string[]; privileges: Privilege[] };

const ROLES = ["oc_collector", "oc_app", "oc_backup"] as const;
type Role = (typeof ROLES)[number];

const REGISTRY = [
  "region",
  "clinic",
  "clinic_name",
  "clinic_external_id",
  "clinic_region",
  "treatment",
  "treatment_name",
  "treatment_epr_procedure",
  "clinic_treatment_offering",
];
const VALIDITY = [
  "clinic_name",
  "clinic_external_id",
  "clinic_region",
  "treatment_name",
  "treatment_epr_procedure",
  "clinic_treatment_offering",
];

const RULES: Record<Role, Rule[]> = {
  oc_collector: [
    { schema: "core", tables: "all", privileges: ["SELECT"] },
    { schema: "availability", tables: "all", privileges: ["SELECT"] },
    { schema: "core", tables: [...REGISTRY, "job_run", "alert"], privileges: ["INSERT"] },
    { schema: "core", tables: [...VALIDITY, "job_run", "alert"], privileges: ["UPDATE"] },
    {
      schema: "availability",
      tables: [
        "measurement",
        "comparison",
        "slot_list",
        "daily_value",
        "daily_slot_list",
        "site_incident",
        "change_event",
      ],
      privileges: ["INSERT"],
    },
    { schema: "availability", tables: ["daily_value", "daily_slot_list"], privileges: ["UPDATE"] },
  ],
  oc_app: [
    { schema: "core", tables: "all", privileges: ["SELECT"] },
    { schema: "availability", tables: "all", privileges: ["SELECT"] },
    { schema: "auth", tables: "all", privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
    { schema: "core", tables: ["job_run", "alert", "app_error"], privileges: ["INSERT"] },
    { schema: "core", tables: ["job_run", "alert"], privileges: ["UPDATE"] },
  ],
  oc_backup: [
    { schema: "core", tables: "all", privileges: ["SELECT"] },
    { schema: "availability", tables: "all", privileges: ["SELECT"] },
    { schema: "core", tables: ["job_run"], privileges: ["INSERT", "UPDATE"] },
  ],
};

const FUNCTIONS: Record<string, Role[]> = {
  "core.reserve_email(text,integer)": ["oc_collector", "oc_app"],
  "core.admin_emails()": ["oc_collector", "oc_app"],
  "core.prune()": ["oc_app"],
};

const PRIVILEGES: Privilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"];
const VERB: Record<Privilege, string> = {
  SELECT: "read",
  INSERT: "insert into",
  UPDATE: "update",
  DELETE: "delete from",
  TRUNCATE: "truncate",
};

function expected(role: Role, schema: string, table: string): Set<Privilege> {
  return new Set(
    RULES[role]
      .filter((rule) => rule.schema === schema && (rule.tables === "all" || rule.tables.includes(table)))
      .flatMap((rule) => rule.privileges),
  );
}

/** Every difference, as "role: may delete from core.clinic" or "role: can't read core.alert". */
export async function rightsDifferences(client: Client): Promise<{ role: string; difference: string }[]> {
  const tables = await client.query<{
    role: Role;
    schema: string;
    table: string;
    select: boolean;
    insert: boolean;
    update: boolean;
    delete: boolean;
    truncate: boolean;
  }>(
    `SELECT r.role, n.nspname AS schema, c.relname AS table,
            has_table_privilege(r.role, c.oid, 'SELECT') AS select,
            has_table_privilege(r.role, c.oid, 'INSERT') AS insert,
            has_any_column_privilege(r.role, c.oid, 'UPDATE') AS update,
            has_table_privilege(r.role, c.oid, 'DELETE') AS delete,
            has_table_privilege(r.role, c.oid, 'TRUNCATE') AS truncate
     FROM unnest($1::text[]) AS r(role)
     CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('core', 'availability', 'auth') AND c.relkind IN ('r', 'p')
     ORDER BY 1, 2, 3`,
    [ROLES],
  );
  const differences: { role: string; difference: string }[] = [];
  for (const row of tables.rows) {
    const want = expected(row.role, row.schema, row.table);
    for (const privilege of PRIVILEGES) {
      const has = row[privilege.toLowerCase() as Lowercase<Privilege>];
      const name = `${row.schema}.${row.table}`;
      if (has && !want.has(privilege))
        differences.push({ role: row.role, difference: `may ${VERB[privilege]} ${name}` });
      if (!has && want.has(privilege))
        differences.push({ role: row.role, difference: `can't ${VERB[privilege]} ${name}` });
    }
  }

  const functions = await client.query<{ role: Role; fn: string; allowed: boolean }>(
    `SELECT r.role, f.fn, has_function_privilege(r.role, f.fn, 'EXECUTE') AS allowed
     FROM unnest($1::text[]) AS r(role) CROSS JOIN unnest($2::text[]) AS f(fn)`,
    [ROLES, Object.keys(FUNCTIONS)],
  );
  for (const row of functions.rows) {
    const want = FUNCTIONS[row.fn]?.includes(row.role) ?? false;
    if (row.allowed !== want) {
      differences.push({ role: row.role, difference: `${row.allowed ? "may" : "can't"} run ${row.fn}` });
    }
  }

  // The roles are created with SQL and never get another role's rights (plan 10.4).
  const memberships = await client.query<{ role: string; granted: string }>(
    `SELECT u.rolname AS role, g.rolname AS granted
     FROM pg_catalog.pg_auth_members m
     JOIN pg_catalog.pg_roles u ON u.oid = m.member JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
     WHERE u.rolname = ANY($1::text[])`,
    [ROLES],
  );
  for (const row of memberships.rows)
    differences.push({ role: row.role, difference: `is a member of ${row.granted}` });
  return differences;
}
