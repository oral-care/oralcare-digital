// Expand and contract (plan 10.5): a migration may not drop or rename a table or
// column, or add NOT NULL without a default, unless it is a clean-up migration
// whose file name ends in -contract.sql.
import { readdirSync, readFileSync } from "node:fs";

const RULES = [
  [/\bDROP\s+TABLE\b/i, "drops a table"],
  [/\bDROP\s+COLUMN\b/i, "drops a column"],
  [/\bRENAME\b/i, "renames something"],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, "adds NOT NULL to an existing column"],
  [
    /\bADD\s+COLUMN\s+(?:(?!DEFAULT)[^;])*\bNOT\s+NULL\b(?:(?!DEFAULT)[^;])*;/i,
    "adds a NOT NULL column without a default",
  ],
];

const problems = [];
for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql"))) {
  if (file.endsWith("-contract.sql")) continue;
  const sql = readFileSync(`migrations/${file}`, "utf8").replace(/--.*$/gm, "");
  for (const [pattern, what] of RULES) {
    if (pattern.test(sql))
      problems.push(`migrations/${file} ${what}. Do it in a later *-contract.sql migration.`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
