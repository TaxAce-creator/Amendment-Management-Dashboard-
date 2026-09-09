# Requirements Traceability

This matrix maps the approved standalone rebuild requirements to implementation evidence. It intentionally follows the user-approved corrections over conflicting older design documents.

| Requirement | Implementation evidence | Verification evidence / status |
| --- | --- | --- |
| Zero Manus runtime/build-time dependency | Standalone React/Vite/Express/tRPC stack; Manus runtime/plugin/services removed; repository-owned branding; standard Google/MySQL/S3 integration | `pnpm standalone:audit` enforced in CI plus build/contracts |
| Preserve roles exactly: Admin, EA Reviewer, Preparer, Viewer | `shared/taxace.ts`, `drizzle/schema.ts`, authorization/settings routers | Role contract tests and settings UI |
| Admin / EA Reviewer / Preparer are full/admin-equivalent | capability model in `shared/taxace.ts`; server `requireCapability` | `server/production-contracts.test.ts` |
| Viewer is view/export only | capability model; server guards; UI mutation controls restricted; Settings direct-route/write gap closed | production and Slice 6/7 contract tests + final Viewer browser acceptance |
| Google Workspace authentication | `server/auth/*`, opaque DB-backed sessions, exact domain checks, pre-provisioning | auth/domain/security tests; final real Google login requires external OAuth credentials |
| Exact authorized email domain `taxacebsi.com` | `server/authorization.ts`, Google claim validation, production env validation | `server/taxace-domain.test.ts`, auth tests |
| Fresh standalone DB with retained/refined schema design | standalone baseline migrations, Drizzle schema, MySQL 8-compatible DB | Slice 3 database acceptance; CI migration/seed |
| No fake operational records | static reference seed only; import and user workflows create operational data | README/checklist; DB acceptance |
| Real Canopy Task Export contract | `server/imports/canopy/contract.ts`, parser/service/router | parser tests + real morning/afternoon acceptance |
| Exact Canopy headers | Pinned, Status, Task, Client, Task Type, Parent Task, Tax Year, Return Type, Due date, Assignee | parser/header reference and import UI |
| Canopy Status is not TaxAce workflow | separate source projection fields and UI source-context labels | Opportunity/Workspace/Reporting implementation |
| Canopy Task/Assignee/Due date semantics preserved without invented TaxAce meanings | source cluster/observation schema and import mapping | import tests + source reporting |
| Source work group = normalized Client + Parent Task + Return Type | Canopy import keying/service | real-export acceptance: morning 11; afternoon 19 work groups |
| Logical task identity excludes mutable source fields | Canopy parser/keying logic | snapshot regression verification |
| Newer source snapshots update projection; older cannot roll back | import service sourceExportedAt ordering | real snapshot regression script/acceptance |
| Missing row never means deletion | import projection logic has no absence-driven deletion | import acceptance/checklist |
| Source traceability to batch/file/row | `import_batches`, `canopy_task_observations`, work groups/clusters, import history | Source Analysis batch provenance + import acceptance |
| Import creates source reviews, not Amendments | Canopy import service/router | DB acceptance explicitly verifies zero automatic Amendments |
| Opportunity Center uses real source facts | Opportunity router/UI and source context | Slice 4/5 operational acceptance |
| Amendment Audit Pro is active/internal/human-driven | `server/routers/auditPro.ts`, Opportunity Center Audit Pro UI, audit schema | `server/audit-pro.contract.test.ts` + Slice 5 DB acceptance |
| Audit Pro does not use AI/external recommendation service | manual audit fields/outcomes only | code contract and architecture audit |
| No Amendment Needed / Deferred / Ready to Create / Create flows | Audit Pro router/state transitions | Slice 5 acceptance |
| Controlled Amendment creation | Audit Pro controlled create + amendment operations | Slice 5/6 tests and DB acceptance |
| Transactional create/import/split/merge/closure | Canopy service, Audit Pro creation, `server/routers/amendmentOperations.ts`, transaction policy | Slice 4–6 DB acceptance and tests |
| Split preserves coverage/source context/assignments | amendment operations | Slice 6 acceptance and transaction-policy tests |
| Merge actually moves tax years and preserves source links | hardened merge operations | Slice 6 acceptance and tests |
| Closure requires closed Tax Years | transaction policy and operations router | production contract tests + Slice 6 acceptance |
| Activity History append-only | activity service/schema/DB protections and material-action writes | append-only DB verification + contract tests |
| Committed Canopy observations append-only | DB triggers/baseline + observation service | Slice 4 database verification |
| Tracker operational filters and real user names | `operationalViews.tracker`, Tracker UI | Slice 6 UI contracts/final browser checklist |
| Global Search includes TaxAce and Canopy source work groups | `operationalViews.search`, Global Search UI | Slice 6 contracts |
| Work Queues support My Queue / Unassigned / EA Review / All | `operationalViews.workQueue`, UI | Slice 6 contracts |
| Saved Views restore operational state | dedicated Saved Views router + Tracker restoration | Slice 6 contract tests |
| Pipeline uses TaxAce workflow, source context separately | Pipeline UI/read model | Slice 6 contract tests |
| Reporting uses persisted data only | reporting/operational/source reporting routers | no-data UI and final checklist |
| Source Analysis includes Return Type, Parent Task, Canopy Status, Tax Year, source assignee | `server/routers/sourceReporting.ts`, Reports Source Analysis tab | Slice 7 CI/contracts |
| Source Analysis includes batch provenance | `sourceReporting.summary().batches` + Reports provenance table | Slice 7 implementation |
| CSV/XLSX/PDF exports respect filters | `server/routers/reportExports.ts`; Reports sends active search/status | `server/slice7-reporting.contract.test.ts` |
| Exports are private and auditable | private storage + signed URL + Activity History | report export router |
| In-app notification bell is functional | `server/routers/notifications.ts`, `TaxAceLayout.tsx` | `server/slice7-notifications-settings.contract.test.ts` |
| Notification categories: assignment, overdue, client signature, document request, EA review | notification router derived alert rules | Slice 7 contracts |
| Email/SMS notification integrations remain out of scope | no delivery integration; preference-driven in-app center only | architecture/README |
| Settings includes approved configuration/import lanes | Settings tabs and settings router | UI implementation |
| Reference Data / Opportunity Import do not invent contracts | governed empty lanes only | Settings UI |
| Official branding and local asset ownership | `client/public/brand/taxace-logo.png`, local app assets | browser acceptance |
| Local Poppins typography with no Google Fonts runtime | `@fontsource/poppins` package; local CSS imports in `client/src/main.tsx`; external font links removed | standalone boundary audit + build |
| Recharts only for application charts | Reports/Dashboard chart implementation | dependency/code audit |
| SheetJS dependency modernized from legacy npm package | official SheetJS 0.20.3 distribution URL locked in `package.json`/`pnpm-lock.yaml` | CI install/build/export contracts |
| Responsive/empty/loading/error/focus behavior | shared TaxAce components and page states | final browser checklist |
| Production HTTP hardening | `server/httpSecurity.ts`, same-origin tRPC guard | security tests/checklist |
| Production configuration fails fast | `validateRuntimeEnvironment()` | production contract/checklist |
| Health/readiness endpoints | `/health/live`, `/health/ready` | deployment checklist |
| Containerized one-service deployment | `Dockerfile`, `.dockerignore` | Docker build acceptance |
| GitHub CI | `.github/workflows/ci.yml` | final green workflow required before merge |
| Beginner README / deployment guide | `README.md`, `docs/DEPLOYMENT.md` | completed in finalization branch |
| Final verification checklist | `docs/FINAL_VERIFICATION_CHECKLIST.md` | completed; external OAuth item intentionally remains human-dependent |

## Approved out-of-scope integrations

The standalone application does not implement:

- Canopy API, polling, webhook, synchronization, or write-back;
- Canopy document storage;
- IRS/FTB integrations;
- QuickBooks integrations;
- client portal;
- AI-generated amendment recommendations or amendment records.

## External launch dependency

Source code cannot contain production Google OAuth secrets. The final browser sign-in test therefore remains a deployment/configuration acceptance step after the OAuth Client ID/Secret and redirect URI are configured outside Git.
