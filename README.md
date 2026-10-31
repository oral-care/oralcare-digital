# Oral Care Digital

Internal web app for Oral Care Group: what patients can book on oralcare.se,
compared with what Muntra publishes, over time. Specification: `docs/plan.md`.
Working rules: `AGENTS.md`.

## Run locally

Node 24 (`.nvmrc`) and pnpm 10 (`packageManager`).

```sh
pnpm install
pnpm test
pnpm test:integration
pnpm dev
```

## Deploy

Pushes to `main` run `.github/workflows/deploy.yml`: the CI checks, then the
migrations as `oc_migrator`, then `vercel deploy --prod` (plan 16.1). Nothing is
deployed through Vercel's Git integration.
