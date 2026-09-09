# Phase 3 Slice 3 — Standalone Database Foundation

## Scope
This slice replaces the Manus-era migration chain with one fresh standalone MySQL baseline. It does not migrate operational Manus data.

## Local stack
`docker compose up -d` starts MySQL 8.4 and private MinIO. Copy `.env.example` to `.env`, change local passwords if desired, then run `pnpm db:migrate`, `pnpm db:seed`, and `pnpm user:bootstrap <admin@taxacebsi.com>`.

## Data integrity controls
- MySQL pool is explicit, UTC-based, and supports TLS via `DATABASE_SSL=true`.
- Amendment creation, closure, split, and merge execute inside DB transactions.
- Merge now moves source Tax Year Records to the target instead of merely closing/linking the source.
- Split preserves selected Tax Year Records and creates matching current assignments, including the source EA Reviewer when present.
- Source assignment rows are retained as history and ended during merge.
- `activity_history` is append-only at the database layer with UPDATE/DELETE guard triggers.
- Static reference seed is idempotent and creates no client, opportunity, amendment, or task records.

## Fresh database rule
The baseline is designed for a fresh standalone database. Do not run it against a production database created from the old Manus migration chain.
