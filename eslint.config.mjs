import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";

// Same base as oralcare.se, plus the layer rules in plan 13.3.

const policy = (from, to) => ({
  from: { element: { type: from } },
  allow: { to: { element: { types: { anyOf: to } } } },
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/incompatible-library": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        // First match wins, so the narrow patterns come first.
        { type: "cron-route", pattern: "src/app/api/cron/**" },
        { type: "app", pattern: "src/app/**" },
        { type: "components", pattern: "src/components/**" },
        { type: "jobs", pattern: "src/jobs/**" },
        { type: "data", pattern: "src/lib/*/data/**" },
        { type: "server", pattern: ["src/lib/auth/**", "src/lib/users/**"] },
        { type: "lib", pattern: "src/lib/**" },
      ],
    },
    rules: {
      // Layers only import downwards, and only cron routes reach the jobs.
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            policy("cron-route", ["jobs", "lib"]),
            policy("app", ["app", "components", "data", "server", "lib"]),
            policy("components", ["components", "lib"]),
            policy("data", ["data", "server", "lib"]),
            policy("server", ["server", "lib"]),
            policy("jobs", ["jobs", "lib"]),
            policy("lib", ["lib"]),
          ],
        },
      ],
    },
  },
  {
    // The jobs and the pure code run in tsx and Vitest, where "server-only" throws.
    files: ["src/jobs/**/*.ts", "src/lib/**/*.ts"],
    ignores: ["src/lib/db/app.ts", "src/lib/auth/**", "src/lib/users/**", "src/lib/*/data/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "server-only", message: "Jobs and pure code must run outside Next.js (plan 13.3)." },
            { name: "react", message: "Jobs and pure code don't use React." },
          ],
          patterns: [
            {
              group: ["next/*", "@/app/*", "@/components/*"],
              message: "Jobs and pure code don't use Next.js.",
            },
          ],
        },
      ],
    },
  },
  {
    // All day and hour arithmetic goes through src/lib/time.ts (plan 13.3).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/time.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(getHours|getDate|getDay|getMonth|getFullYear|setHours|setDate)$/]",
          message: "Use src/lib/time.ts: local Date getters depend on the computer's time zone.",
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "migrations/**"]),
]);

export default eslintConfig;
