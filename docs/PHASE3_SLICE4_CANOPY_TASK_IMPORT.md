# Phase 3 Slice 4 — Canopy Task Import and Provenance

## Purpose

Slice 4 replaces the guessed Client Data Import with the real Canopy Tasks export contract used by TaxAce. It remains a manual source-file boundary: TaxAce does not call Canopy APIs, poll Canopy, use Canopy webhooks, write back to Canopy, or store Canopy documents.

Importing source data does **not** create Amendment Records automatically. A committed Canopy Task Import creates or updates source provenance, source work groups, logical task clusters, append-only observations, and pending Opportunity Reviews. A TaxAce user must later review the source work group and explicitly create an Amendment Record when appropriate.

## Real Canopy task-export header

The approved required columns, in source terminology, are:

1. `Pinned`
2. `Status`
3. `Task`
4. `Client`
5. `Task Type`
6. `Parent Task`
7. `Tax Year`
8. `Return Type`
9. `Due date`
10. `Assignee`

Extra source columns are allowed and retained in observation provenance. Missing required columns are rejected.

## Source semantics

- `Pinned` is retained as source state. It is not TaxAce priority.
- `Status` is the Canopy Task Status. It is not the TaxAce Workflow Status.
- `Task` is the Canopy task title. It is not an amendment reason.
- `Client` is the source display name. Canopy does not provide a source Client ID in these exports.
- `Task Type` is retained as supplied by Canopy.
- `Parent Task` identifies the source work-group context.
- `Tax Year` is stored directly.
- `Return Type` is stored directly. TaxAce does not infer Client Type from it.
- `Due date` is the Canopy task due date. It is not the TaxAce amendment due date.
- `Assignee` is stored as raw source text and parsed into comma-separated display names. It never auto-creates or assigns a TaxAce user.

## Internal TaxAce client records

The export contains no authoritative Canopy client identifier. TaxAce therefore uses an internal `TaxAce Client Record ID` and controlled source aliases.

Resolution order:

1. exact normalized Canopy alias match;
2. exact normalized internal client-name match;
3. otherwise create a new TaxAce Client Record with only the source-supported name populated.

The importer does not use fuzzy matching. If multiple internal records match the exact normalized name, import is blocked until a controlled alias is established.

## Work-group and logical-cluster keys

A Canopy source work group is:

`normalized Client + Parent Task + Return Type`

A logical Canopy task cluster is:

`work-group key + Task + Task Type + Tax Year`

Mutable source fields are deliberately excluded from the logical key:

- Canopy Status
- Due date
- Pinned
- Assignee

Those fields determine whether a newer observation is `Changed` or `Unchanged`.

Full human-readable keys are stored for traceability. SHA-256 hashes are used for safe unique indexes under MySQL `utf8mb4`; the service also verifies that a matching hash contains the same full key before using it.

## Duplicate and conflict handling

Repeated rows with the same logical key and the same mutable source values are retained as `Duplicate Occurrence` observations. They are not import errors.

Rows with the same logical key but different mutable source state inside the same export are `Duplicate / Conflict` rows and block commit.

## Snapshot ordering

The importer derives `Source Exported At` from filenames matching the real convention, such as:

- `CanopyTasks_2026-08-21_09.59AM(1).csv`
- `CanopyTasks_2026-08-21_05.34PM(3).csv`

When the timestamp cannot be derived, the user must enter and confirm it before validation.

Every committed row is retained as an observation. Current cluster projections are updated only when the incoming snapshot is at least as new as the cluster's current `lastSeenSourceExportedAt` value. An older snapshot is retained as `Older Snapshot` provenance but never rolls back current source state.

Absence from a later Canopy export never deletes, archives, closes, or otherwise changes a prior source work group, task cluster, Opportunity Review, or Amendment Record.

## Append-only provenance

`canopy_task_observations` is protected by database triggers that reject UPDATE and DELETE operations. Observations are append-only in the same way Activity History is append-only.

Each observation retains:

- import batch;
- source row number;
- all ten approved source fields;
- parsed assignees;
- work-group key and hash;
- logical key and hash;
- row hash;
- projection hash;
- raw source row;
- extra source columns;
- source-export timestamp.

## Upload and validation boundary

The UI uses a private presigned object-storage PUT URL. The browser uploads directly to the private S3-compatible bucket; file contents are no longer serialized into a base64 tRPC payload.

The server verifies the stored object's size before validation and enforces:

- `.csv` and `.xlsx` only;
- `IMPORT_MAX_BYTES`;
- `IMPORT_MAX_ROWS`;
- required headers;
- valid Tax Year;
- blank or valid `YYYY-MM-DD` due date;
- source timestamp availability.

## Transactional commit

A successful confirmed commit runs in a single MySQL transaction for all database mutations. It creates or updates only:

- `client_records` where source-supported;
- `canopy_client_aliases`;
- `canopy_work_groups`;
- `canopy_task_clusters`;
- `canopy_task_observations`;
- source-linked pending `opportunity_reviews`;
- `import_batches` summary fields;
- append-only Activity History.

It does **not** create an Amendment Record.

Result CSV artifacts are generated on demand from committed observations. Artifact-generation failure cannot retroactively mark an already committed database transaction as failed.

## Real export acceptance targets

The real Canopy exports are private operational source files and must not be committed. `.gitignore` excludes `CanopyTasks_*.csv`.

Expected manual regression counts:

### `CanopyTasks_2026-08-21_09.59AM(1).csv`

- Source rows: 13
- Clients: 10
- Work groups: 11
- Logical task clusters: 13
- Duplicate occurrences: 0

### `CanopyTasks_2026-08-21_05.34PM(3).csv`

- Source rows: 267
- Clients: 17
- Work groups: 19
- Logical task clusters: 263
- Duplicate occurrences: 4

The morning logical keys all recur in the afternoon export. Comparison of those recurring logical keys should produce seven exact matches and six mutable-state changes when evaluated from the morning projection into the afternoon snapshot.

## Local source-file verification

Do not copy real Canopy exports into Git. If the files are present locally in the Codespace, run:

```bash
pnpm canopy:verify '/path/to/CanopyTasks_2026-08-21_09.59AM(1).csv' '/path/to/CanopyTasks_2026-08-21_05.34PM(3).csv'
```

The command prints summary counts, parser version, inferred Source Exported At, and file SHA-256 without modifying the database.

## Slice 4 verification gates

Before merging into `main`:

1. `pnpm check`
2. `pnpm test`
3. `pnpm build`
4. apply `0001_canopy_task_import.sql` to the clean Slice 3 database;
5. verify Canopy observation UPDATE is blocked;
6. verify Canopy observation DELETE is blocked;
7. run the two private real exports through `pnpm canopy:verify` when locally available;
8. verify importing a newer snapshot updates current source projection;
9. verify importing an older snapshot retains observations but does not roll back current projection;
10. verify committed imports create pending source-work-group Opportunity Reviews and zero Amendment Records.
