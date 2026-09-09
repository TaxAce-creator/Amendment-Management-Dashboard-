# Production Deployment Guide

## Target architecture

Run TaxAce Amendment Management as one containerized Node service behind an HTTPS load balancer or reverse proxy. The service hosts the compiled React application, `/api/trpc`, `/auth/*`, and the health endpoints.

External production dependencies are:

- a standard MySQL 8-compatible managed database;
- a private S3-compatible object-storage bucket;
- Google Workspace OpenID Connect;
- TLS/HTTPS at the public application origin.

AWS RDS MySQL and private AWS S3 are acceptable defaults, but the application remains provider-neutral for standard MySQL 8 and S3-compatible storage.

## Production environment

Start from `.env.example` and supply production values through the hosting platform's secret/environment manager. Do not place a production `.env` file in Git.

Required configuration includes:

```text
NODE_ENV=production
PORT=3000
APP_ORIGIN=https://YOUR_PRODUCTION_HOST
DATABASE_URL=mysql://...
DATABASE_SSL=true
AUTH_MODE=oidc
AUTH_ISSUER_URL=https://accounts.google.com
AUTH_CLIENT_ID=...
AUTH_CLIENT_SECRET=...
AUTH_ALLOWED_DOMAIN=taxacebsi.com
AUTH_REDIRECT_URI=https://YOUR_PRODUCTION_HOST/auth/callback
SESSION_TTL_HOURS=12
STORAGE_DRIVER=s3
S3_BUCKET=...
S3_REGION=...
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
STORAGE_SIGNED_URL_TTL_SECONDS=300
IMPORT_MAX_BYTES=52428800
IMPORT_MAX_ROWS=10000
IMPORT_RETENTION_DAYS=90
```

For AWS-hosted workloads, prefer an IAM role/workload identity instead of static S3 access keys. When IAM is used, leave both S3 access-key variables unset.

Production startup validates the critical database, Google OAuth, HTTPS origin/redirect, allowed-domain, and storage configuration and refuses to start on invalid placeholder configuration. When `AUTH_MODE` is omitted in production, the runtime defaults to the safer `oidc` mode rather than enabling temporary test authentication. Production deployments should still set `AUTH_MODE=oidc` explicitly.

The local `.env.example` intentionally uses disposable credentials that match `compose.yaml` so a developer can start the local MySQL and MinIO stack without reconciling two different password sets. Those values are local-only and must never be reused as production credentials.

## Database

Use a fresh standalone MySQL database. Do not migrate legacy Manus operational rows into the standalone application.

Recommended production settings:

- MySQL 8 compatible engine;
- encrypted transport/TLS;
- UTC database/application timestamps;
- automated backups and point-in-time recovery where supported;
- restricted network access from the application environment only;
- least-privilege application credentials.

### Release migration sequence

Apply migrations before routing traffic to the new application version:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
```

`db:seed` inserts approved static/reference configuration only. It must not create fake clients, amendments, activity, or metrics.

If this is the first deployment, bootstrap the first Admin after migrations:

```bash
pnpm user:bootstrap admin@taxacebsi.com "Admin Name"
```

The bootstrap command loads the local `.env` when used in development. In production, supply `DATABASE_URL` through the platform environment/secret manager before running it.

Subsequent users are provisioned from Settings by an Admin-equivalent operational user.

## Object storage

The production bucket must be private.

The application writes protected Canopy source files and generated report exports under application-controlled keys and returns only short-lived signed URLs. Do not configure public-read ACLs or a public bucket website.

Set the signed-URL TTL to a short value appropriate for TaxAce operations. The default reference value is 300 seconds.

## Google Workspace OIDC

Create a Google OAuth Web Application client and register the exact production callback:

```text
https://YOUR_PRODUCTION_HOST/auth/callback
```

The application independently enforces the exact `taxacebsi.com` hosted domain and requires an active pre-provisioned application user.

See `GOOGLE_WORKSPACE_AUTH_SETUP.md` for the Google-side checklist.

## Build the container

```bash
docker build -t taxace-amendment-management .
```

The Dockerfile:

- installs the locked dependencies;
- runs type checking, tests, and the production build in the build stage;
- prunes development dependencies;
- runs the final process as the non-root `node` user;
- exposes port 3000;
- defines a liveness health check;
- does not copy local `.env`, private fixtures, or real Canopy exports into the image context.

The runtime command is:

```text
node dist/index.js
```

Migrations are a release step and are not executed automatically by the runtime container.

## Health checks

Use:

```text
GET /health/live
GET /health/ready
```

- `/health/live` returns HTTP 200 when the Node process is serving requests.
- `/health/ready` returns HTTP 200 only when the process can reach both MySQL and the configured private S3-compatible bucket. It returns HTTP 503 when either dependency is unavailable.
- The readiness response reports `database` and `storage` independently so an operator can see which dependency failed.

A load balancer should normally use `/health/ready` for readiness/traffic routing and `/health/live` for process liveness.

Readiness does not replace the release acceptance check for a real protected file upload/download or Google Workspace authentication. Verify those workflows separately before production traffic is enabled.

## HTTPS and proxy configuration

Production traffic must be HTTPS. `APP_ORIGIN` must contain the public origin only, with no path/query/hash, and `AUTH_REDIRECT_URI` must use that same origin plus `/auth/callback`.

The application emits production security headers including HSTS and a restrictive Content Security Policy. Keep TLS termination and forwarded-host configuration consistent with the public application origin.

## CI release gate

The GitHub Actions workflow `Standalone CI` validates Phase 3 branches and pull requests with:

1. locked dependency installation;
2. standalone boundary audit;
3. TypeScript check;
4. unit/contract tests;
5. production build;
6. standalone MySQL migrations;
7. static reference-data seed;
8. production container build.

A production release should not proceed from a red CI commit.

The browser-to-Node private Canopy upload path must also be exercised in the target acceptance environment. CI does not replace this browser/storage check. During acceptance on the Codespaces branch, a real Canopy CSV was uploaded and validated successfully through the same-origin Node route while MySQL and MinIO were running.

## Backup and recovery

TaxAce operations should define retention based on business requirements. At minimum:

- enable managed MySQL automated backups;
- periodically test a database restore;
- enable appropriate S3 versioning/retention controls for protected source files and exports where required;
- protect backup access separately from application credentials.

Activity History and Canopy task observations are append-only at the application level and should be included in database backups.

### Recovery verification

Before launch, perform a non-destructive restart/recovery exercise in the target environment:

1. record the current Amendment Record count and a known Activity History entry;
2. restart the application service without deleting database or storage volumes/buckets;
3. confirm `/health/ready` returns 200 after restart;
4. sign back in and verify the known Amendment Record and Activity History entry still exist;
5. verify a previously uploaded protected Canopy source file remains accessible through the application-authorized path;
6. never use `docker compose down -v`, database-drop commands, or bucket deletion as part of a normal restart test.

## Rollback

For an application-only rollback:

1. retain the previous known-good image/tag;
2. stop routing traffic to the failed image;
3. redeploy the prior image;
4. verify `/health/ready`;
5. investigate before retrying.

Database migrations must be treated as forward migrations. Do not destructively roll back schema/data in production without a reviewed database recovery plan. Restore from a tested backup when a data-level rollback is genuinely required.

## Secret handling

Never store production database passwords, OAuth client secrets, or S3 keys in Git. Use the deployment platform's secret manager.

Rotate credentials immediately if they are exposed in plaintext, a terminal screenshot, commit history, issue, chat, or artifact. Legacy Manus-era credentials must not be reused.

## Production acceptance before launch

Before opening the application to TaxAce users:

- CI is green on the release commit;
- migrations and static seed succeed on production MySQL;
- the first/required users are provisioned;
- `AUTH_MODE=oidc` is explicitly configured;
- Google OAuth redirect URI is registered;
- Admin login succeeds with `@taxacebsi.com`;
- a Viewer login confirms view/export-only behavior;
- private source-file upload and signed download work;
- `/health/live` and `/health/ready` return 200;
- the non-destructive restart/recovery exercise passes;
- the final verification checklist is completed.
