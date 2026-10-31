# Oral Care Digital

Internal web app for Oral Care Group at `https://digital.oralcaregroup.com`. The
complete specification is `docs/plan.md`. Read it before changing anything.

## Rules

- No em dash (U+2014) anywhere: code, comments, texts, commits. `scripts/check-em-dash.mjs` stops it.
- Commit only when the owner writes "commit". Never `--no-verify`, force push or `--amend`.
- No attribution lines and no references to tools in code or commits.
- Branches from `main` named `OC-{ticket}-{kebab-name}`.
- `minimumReleaseAge` (3 days) in `pnpm-workspace.yaml` is never lowered. Only `next`, `@next/*` and `eslint-config-next` are excepted, as in oralcare.se.
- Command-line tools run as exact dev dependencies through `pnpm exec`, never `npx`, `dlx` or `@latest`.
- External GitHub Actions are pinned to a full commit SHA.
- No local styling: every value comes from the design tokens in `src/styles/` (plan 4.14). `scripts/check-design.mjs` stops colour codes, Tailwind arbitrary values, `style` props and extra CSS files.
- Icons only from `lucide-react`, imported by name (plan 4.13).
- Only data fetched from oralcare.se and Muntra is shown. No guessed causes.
- Never log or store raw source responses, review texts, names, contact details, caregiver ids or source error messages. Logs and alerts carry codes.
- Migrations follow expand and contract (plan 10.5). Dropping or renaming only in a `*-contract.sql` migration in a later release.

## Layers (plan 13.3)

`src/app` (routes) uses `src/components` and `src/lib/<module>/data`, which use
`src/lib/<module>` and `src/lib/db`. `src/jobs` and the pure code never import
`server-only`, `next/*` or React, so they run in tsx and Vitest. Only the cron
routes import `@/jobs`. ESLint enforces this.

## Commands

- `pnpm dev`, `pnpm build`
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm check`
- `pnpm test` (unit), `pnpm test:integration` (embedded Postgres 18)
- `pnpm db:generate` after changing `src/lib/db/schema/`
