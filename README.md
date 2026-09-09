# TaxAce Amendment Management Dashboard

TaxAce Amendment Management is a standalone internal application for managing tax-amendment operations from manually exported Canopy task data through Opportunity Review, Amendment Audit Pro, controlled Amendment creation, assignment, workflow progression, tax-year work, reporting, and closure.

The application is intentionally independent from Manus. It has no Manus runtime, build-time plugin, hosted OAuth, Forge service, hosted storage proxy, debug collector, heartbeat, or analytics dependency.

## What the application does

The operating flow is:

1. A TaxAce user manually exports Tasks from Canopy.
2. The file is uploaded through **Settings > Canopy Task Import**.
3. TaxAce validates the real Canopy task-export headers, previews the import, preserves source provenance, and commits the source snapshot transactionally.
4. Source work groups appear in **Opportunity Center**. Importing source data does **not** automatically create Amendment Records.
5. An authorized staff member launches **Amendment Audit Pro**, records a structured human review, and chooses an outcome.
6. If an amendment is appropriate, the user performs controlled Amendment creation and confirms TaxAce-owned fields such as reason, preparer, owner, jurisdiction, priority, and assessment.
7. The Amendment is managed through the canonical TaxAce workflow until all Tax Year Records and the Amendment are closed.
8. Operational dashboards, queues, search, Saved Views, notifications, Activity History, and reporting use persisted TaxAce data and preserved Canopy source context.

There is no AI-generated amendment recommendation, Canopy API synchronization, Canopy write-back, IRS/FTB integration, QuickBooks integration, client portal, or Canopy document storage.

## Approved roles

| Role | Application access |
| --- | --- |
| Admin | Full operational capability set |
| EA Reviewer | Same full operational capability set as Admin |
| Preparer | Same full operational capability set as Admin |
| Viewer | View and export only |

The server enforces authorization. Hiding an action in the browser is not the security boundary.

## Canonical TaxAce workflow

1. Investigation
2. With Client
3. In Progress
4. Ready for EA Review
5. EA Review
6. Waiting for Payment
7. Ready for Signature
8. Ready to File
9. Filed
10. Waiting on IRS / FTB
11. Accepted
12. Closed

Canopy task status is source context only and never controls the TaxAce Workflow Status.

## Real Canopy Task Import contract

The approved Canopy source headers are exactly:

```text
Pinned
Status
Task
Client
Task Type
Parent Task
Tax Year
Return Type
Due date
Assignee
```

Important source rules:

- `Status` means **Canopy Task Status**, not TaxAce Workflow Status.
- `Task` is the Canopy task title, not an Amendment Reason.
- `Client` is the source display name; TaxAce generates its own internal client record identifier.
- `Due date` is a Canopy task due date, not an Amendment due date.
- `Assignee` is preserved as source context and does not automatically create or assign a TaxAce user.
- Work-group identity is based on normalized Client + Parent Task + Return Type.
- Mutable source values such as Status, Due date, Assignee, and Pinned are excluded from logical task identity.
- Newer snapshots may update the current source projection. Older snapshots are preserved but must not roll back a newer projection.
- A row missing from a newer source snapshot never implies deletion or closure.
- Every committed source observation is traceable to its import batch and source row.

Real Canopy exports and client data must never be committed to this repository.

## Standalone architecture

The repository retains the original application architecture while removing platform coupling:

- React 19 + TypeScript
- Vite 7
- Tailwind CSS 4 + shadcn/Radix
- Wouter
- Recharts
- tRPC 11
- Express 4
- Drizzle ORM
- MySQL 8-compatible database
- Google Workspace OpenID Connect
- Private S3-compatible object storage
- Vitest
- PDFKit and SheetJS-compatible workbook APIs
- pnpm

The browser talks to the same Node/Express service through `/api/trpc`. The service also owns `/auth/*`, static production assets, and health endpoints.

## Prerequisites

For local development:

- Node.js 20+
- Corepack/pnpm
- Docker with Docker Compose
- a local `.env` file created from `.env.example`

For real Google sign-in, a Google OAuth Web Application client must also be configured. See [`docs/GOOGLE_WORKSPACE_AUTH_SETUP.md`](docs/GOOGLE_WORKSPACE_AUTH_SETUP.md).

## Beginner local setup

### 1. Install dependencies

```bash
corepack enable
pnpm install --frozen-lockfile
```

### 2. Start local MySQL and MinIO

```bash
docker compose up -d
```

### 3. Create your local environment file

```bash
cp .env.example .env
```

Edit `.env` locally. Never commit it.

### 4. Apply the standalone database migrations

```bash
pnpm db:migrate
```

### 5. Seed static reference configuration

```bash
pnpm db:seed
```

This seed is for canonical/reference configuration only. It does not insert fake clients, amendments, activity, or metrics.

### 6. Provision the first Admin

```bash
pnpm user:bootstrap admin@taxacebsi.com "Admin Name"
```

After the first Admin successfully signs in, Admin, EA Reviewer, or Preparer users can provision additional application users from **Settings > Users**.

### 7. Start the development server

```bash
pnpm dev
```

Open the configured `APP_ORIGIN` or the forwarded Codespaces port.

## Google Workspace authentication

A Google sign-in is authorized only when all of the following are true:

1. Google validates the OpenID Connect response.
2. The email is verified.
3. The signed Google `hd` claim is exactly `taxacebsi.com`.
4. The email address ends with `@taxacebsi.com`.
5. A matching active TaxAce application user was already provisioned in MySQL.

The application uses PKCE, state, nonce, one-time server-side login state, opaque random session tokens, SHA-256 token hashes in MySQL, secure cookies, same-origin checks for state-changing tRPC calls, authentication request rate limiting, and production security headers.

A valid Google Workspace account does not automatically grant application access.

## Amendment Audit Pro

Audit Pro is a live internal human-review workflow inside Opportunity Center. It is not an AI or external-service integration.

It prepopulates only real source facts such as Client, Parent Task, Return Type, Tax Years, Tasks, Task Types, Canopy statuses, source assignees, task due dates, and provenance.

Staff manually records approved TaxAce review fields, including Amendment Reason, Documents Received, Documents Needed, Amendment Assessment, Estimated Tax Impact when known, risk/issue notes, reviewer notes, Recommendation, and Priority.

Approved outcomes are:

- **No Amendment Needed** — close the opportunity review without creating an Amendment.
- **Deferred** — preserve the review for later action.
- **Ready to Create Amendment** — complete the review and enable controlled creation.
- **Create Amendment** — execute the transactional creation flow with user confirmation of TaxAce-owned operational fields.

## Transactional Amendment operations

Material operations are server-authorized, validated, and transactionally persisted where required. This includes controlled creation, assignment changes, workflow progression, split, merge, closure, and related Tax Year/source-link preservation.

Activity History records material actions with the acting user and correlation context. Activity History and committed Canopy task observations are append-only.

## Reporting and notifications

Reporting uses persisted TaxAce and Canopy source data only. The application includes operational, department, preparer, EA, workflow-aging, turnaround, tax-year, source, reason, bottleneck, and productivity views.

CSV/XLSX/PDF operational exports respect the active report filters and are written to private object storage before a short-lived signed URL is returned. Export events record their filter context and row count in Activity History.

Source Analysis includes current source dimensions and recent Canopy import-batch provenance so management can trace analytics back to source snapshots.

The header notification center derives in-app operational alerts from persisted assignment, aging, client-response/signature, and EA-review state. Email and SMS delivery are intentionally out of scope.

## Verify the repository

Run:

```bash
pnpm check
pnpm test
pnpm build
```

The repository also contains a GitHub Actions **Standalone CI** workflow that runs type checking, tests, production build, MySQL migrations, and static reference seeding on Phase 3 branches and pull requests to `main`.

## Production container

A production `Dockerfile` is included. Build it with:

```bash
docker build -t taxace-amendment-management .
```

The production runtime serves the compiled React application and Node API as one service on port 3000. Production configuration is injected at runtime; secrets are not baked into the image.

Database migrations must be applied as a deployment/release step before the new application container receives traffic.

Health endpoints:

```text
GET /health/live
GET /health/ready
```

`/health/live` verifies that the process is serving HTTP. `/health/ready` also verifies database connectivity.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the production checklist.

## Security and data handling

- Never commit `.env` or OAuth credentials.
- Never commit real Canopy exports, database dumps, client files, access keys, or other client data.
- Use HTTPS in production.
- Keep the production S3-compatible bucket private.
- Prefer workload/IAM credentials where the hosting environment supports them.
- Rotate or revoke any credential that has ever been exposed in plaintext.
- Back up the production MySQL database according to TaxAce retention requirements.
- The standalone database is a fresh operational database; do not copy legacy Manus operational records into it.

## Deployment configuration still supplied outside Git

The codebase is complete without storing these secrets in the repository, but a live production environment still requires:

- production MySQL host/credentials;
- production private S3-compatible bucket and credentials/IAM role;
- Google OAuth Client ID and Client Secret;
- production HTTPS `APP_ORIGIN` and matching `/auth/callback` redirect URI.

Google OAuth credential creation and the final real-browser sign-in test are intentionally external to source control.

## Documentation

- [`docs/GOOGLE_WORKSPACE_AUTH_SETUP.md`](docs/GOOGLE_WORKSPACE_AUTH_SETUP.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/FINAL_VERIFICATION_CHECKLIST.md`](docs/FINAL_VERIFICATION_CHECKLIST.md)
- [`docs/REQUIREMENTS_TRACEABILITY.md`](docs/REQUIREMENTS_TRACEABILITY.md)
- Slice-specific implementation/verification notes under `docs/`

## Final build principle

Operational screens must show only facts from an approved source: a committed Canopy source observation/batch, a TaxAce user action, deterministic calculation, or approved reference configuration. Unknown source facts remain unknown; the application does not invent identifiers, statuses, financial values, assignments, or amendment recommendations.
