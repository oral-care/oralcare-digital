import path from "node:path";

import { defineConfig } from "vitest/config";

// Unit tests sit next to the code; integration tests run against a real
// Postgres in tests/integration (plan 15). Unit tests run twice in CI, with
// TZ=UTC and TZ=America/New_York, so nothing depends on the computer's zone.
const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "tests/support/server-only.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
