# TaxAce Amendment Management Dashboard — Final Pre-Handoff Audit

**Audit date:** 2026-09-07  
**Repository:** `LyndonMarketingTech/Amendment-Management-Dashboard`  
**Acceptance branch:** `fix/codespaces-canopy-upload`  
**Pull Request:** #7  
**Disposition:** Application code is in final team-acceptance posture. Do not merge to `main` until final browser acceptance and the latest CI run are green.

## Scope reviewed

This final pass re-reviewed the application as one integrated system rather than as isolated defect tickets. The review covered:

- standalone / Manus boundary;
- authentication and role capabilities;
- Canopy Task Import and source provenance;
- Opportunity Center and Global Search deep-link behavior;
- Amendment Audit Pro and controlled Amendment creation;
- Amendment Tracker bulk actions and assignment controls;
- Amendment Workspace operational actions;
- Pipeline transitions;
- Tax Year Records;
- split / merge preservation and financial provenance;
- Settings, Saved Views, Reports, Work Queues, Activity History, and exports;
- responsive tab/navigation behavior;
- local environment/bootstrap consistency;
- production authentication defaults;
- database and private object-storage readiness;
- deployment/recovery guidance;
- regression/contract coverage and CI gate.

## Final defect disposition

### P0 — data loss / corruption / unsafe mutation

**No known open P0 defect.**

Key protections verified in code include:
- Canopy observations are append-only source history and older snapshots cannot roll current projection backward;
- import never automatically creates Amendment Records;
- Viewer mutation access is denied server-side;
- controlled workflow transitions are server-validated;
- split/merge preserves Tax Year Records and their year-level financial values;
- split/merge does not guess, duplicate, sum, or silently allocate amendment-level financial aggregates;
- previous split/merge aggregate values remain traceable in append-only Activity History;
- merged/Closed records are protected from inappropriate operational mutation;
- assignment mutations reject inactive users and Viewer accounts.

### P1 — core workflow blocker

**No known open P1 defect.**

Previously identified blockers have been remediated:
- Codespaces browser upload no longer targets private `127.0.0.1:9000` directly;
- Global Search source results open the correct Opportunity Review without mutating status merely by navigation;
- Opportunity Center exposes decision-critical review context and now keeps the Audit Pro action directly accessible;
- Amendment Audit Pro is a real internal workflow with explicit controlled creation;
- split/merge financial provenance is explicit and regression-tested.

### P2 — operational UX / error-prevention

**All previously catalogued P2 items have been addressed in this branch.**

Final-pass fixes include:
- Opportunity Center changed from a very wide manager table to a responsive card review queue;
- all operational TabsList navigation wraps so Settings/Reports/Workspace destinations are visible without a hidden horizontal scrollbar;
- Amendment Audit Pro shows durable Saved / Unsaved / Saving state and warns before discarding unsaved work;
- Amendment Tracker bulk actions lock while applying;
- bulk Workflow Status choices show only transitions structurally valid for every selected record;
- incompatible selected workflow stages show a clear no-common-target message;
- Tracker selections are pruned after filter/result changes;
- Viewer accounts are removed from operational assignment choices;
- Canopy import controls lock consistently while upload/validate/commit/cancel operations are pending;
- cancelled Canopy batches clean up local UI state;
- Settings save states, Reference List pending/reset behavior, and Saved View deletion confirmation are implemented;
- Pipeline identifies valid/invalid structural destinations before drop.

## Environment and production-hardening findings

### Resolved in code/configuration

- `.env.example` local MySQL/MinIO values now match `compose.yaml` disposable local credentials.
- Admin bootstrap imports `dotenv/config`, so local `.env` is loaded by the documented bootstrap command.
- Production no longer defaults to temporary test auth when `AUTH_MODE` is omitted; production defaults to OIDC.
- Runtime production configuration validation still fails closed on placeholder or invalid critical settings.
- `/health/ready` now requires both MySQL and private S3/MinIO bucket readiness and reports each dependency separately.
- same-origin import upload default size aligns with the configured 50 MB import maximum.
- deployment documentation includes safe migration, private storage, production OIDC, health, backup, rollback, and non-destructive restart/recovery guidance.

### Intentionally external / target-environment dependent

These cannot be completed solely by repository code and remain launch gates rather than known application defects:
- real Google Workspace OAuth client ID/secret and exact production callback registration;
- real production/staging `@taxacebsi.com` OIDC browser sign-in;
- production MySQL and private object-store provisioning/secrets/networking;
- target-environment protected source upload/download acceptance;
- target-environment restart/recovery and backup/restore validation;
- final production secret rotation/management and infrastructure retention settings.

## Browser evidence already observed

During the 2026-09-07 acceptance session, TaxAce directly observed:

1. The acceptance Codespace was running the correct branch.
2. MySQL was started and reached healthy state.
3. Standalone database migrations applied successfully.
4. Temporary acceptance sign-in successfully created an application session after database startup/migration.
5. A real Canopy Tasks CSV uploaded and validated through the browser/application/private-storage path.
6. The 13-row source file validated as:
   - 13 source rows;
   - 10 clients;
   - 11 work groups;
   - 13 logical clusters;
   - 13 accepted;
   - 0 rejected;
   - 0 conflicts;
   - 13 older-snapshot observations.
7. The older snapshot was not committed as current state, demonstrating rollback protection behavior in the acceptance UI.
8. TaxAce reviewed the new Opportunity Center responsive card UI and explicitly approved the direction as substantially easier to use.

These observations supplement automated tests; they do not replace the remaining end-to-end workflow acceptance steps.

## Automated regression coverage added/updated

The branch includes focused contracts/tests for:
- Viewer read-only Amendment Audit Pro behavior;
- active internal Amendment Audit Pro labels and controlled creation;
- exact proxied-origin trust and cross-Codespace rejection;
- split/merge financial aggregate invalidation and provenance;
- Workspace operational-action boundaries;
- final handoff UI contracts covering Opportunity Center accessibility, Audit Pro save state, Tracker bulk safeguards, wrapped operational tabs, and local configuration/bootstrap consistency.

`Standalone CI` remains the authoritative automated gate for the latest branch head and runs:
- dependency installation;
- standalone boundary audit;
- TypeScript check;
- unit and contract tests;
- production build;
- database migrations;
- static reference seed;
- production container build.

## Final team acceptance focus

The team should now concentrate on behavioral verification, not exploratory defect hunting across already-reviewed implementation areas. Use `docs/TEAM_REVIEW_READINESS_2026-09-07.md` and focus on:

1. Admin / EA Reviewer / Preparer equivalence and Viewer negatives.
2. A current/newer Canopy import commit and source projection advancement.
3. Global Search → exact Opportunity card deep-link without status mutation.
4. Audit Pro draft persistence, unsaved warning, all three outcomes, and separate controlled creation.
5. Created Amendment Workspace assessment/document/workflow actions.
6. Tracker bulk valid-status behavior and pending lock.
7. Pipeline prerequisite rejection.
8. Split and merge provenance using controlled multi-year test records.
9. Settings / Saved Views / Reports / Activity / exports.
10. `/health/live`, `/health/ready`, and non-destructive restart persistence in acceptance.

## Handoff decision

Once the latest PR-head CI is green and the browser checklist is completed without an unresolved P0/P1 finding, PR #7 is suitable for explicit merge approval.

A green CI result alone is not merge approval, and this document does not authorize production go-live. Production go-live still requires the external target-environment gates listed above.
