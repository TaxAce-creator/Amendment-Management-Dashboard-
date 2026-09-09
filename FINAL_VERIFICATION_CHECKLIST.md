# Final Verification Checklist

Use this checklist for the final standalone acceptance. Check only items that were actually observed in the target environment.

## Repository and build

- [ ] Working tree is clean on the final release branch/commit.
- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm check` succeeds.
- [ ] `pnpm test` succeeds.
- [ ] `pnpm build` succeeds.
- [ ] GitHub Actions `Standalone CI` is green for the final commit.
- [ ] `docker build -t taxace-amendment-management .` succeeds.
- [ ] No `.env`, real Canopy exports, database dumps, OAuth secrets, or client files are tracked by Git.

## Standalone/platform boundary

- [ ] Repository has no runtime/build-time Manus plugin or service dependency.
- [ ] No Manus OAuth, Forge, heartbeat, storage proxy, debug collector, hosted asset, or analytics-injection runtime remains.
- [ ] Official TaxAce logo loads from the repository-owned asset.
- [ ] Application can run using standard MySQL, Google OIDC, and private S3-compatible storage.

## Database

- [ ] Fresh MySQL database accepts `pnpm db:migrate`.
- [ ] `pnpm db:seed` inserts canonical/reference configuration only.
- [ ] Fresh database contains no fake/legacy operational Manus rows.
- [ ] Activity History cannot be edited/deleted through application operations.
- [ ] Committed Canopy task observations are append-only.

## Authentication and roles

- [ ] Google OAuth Web Application client is configured outside Git.
- [ ] Exact production/dev callback URI is registered with Google.
- [ ] `@taxacebsi.com` Admin login succeeds.
- [ ] A valid but non-provisioned Workspace account is denied.
- [ ] A non-`taxacebsi.com` identity is denied.
- [ ] Deactivated users cannot retain active application sessions.
- [ ] Admin, EA Reviewer, and Preparer can perform the same approved full operational capabilities.
- [ ] Viewer can view/search/export but cannot create/edit/assign/advance/archive/split/merge/close/import/manage settings/manage users/save/delete operational views.

## Canopy Task Import

Use the sanitized/manual real-export acceptance copies, never committed source files.

### Morning snapshot

Expected source facts:

- [ ] 13 source rows.
- [ ] 10 clients.
- [ ] 11 work groups.
- [ ] 13 logical task clusters.
- [ ] 0 duplicate logical occurrences.

### Afternoon snapshot

Expected source facts:

- [ ] 267 source rows.
- [ ] 17 clients.
- [ ] 19 work groups.
- [ ] 263 logical task clusters.
- [ ] 4 duplicate logical occurrences.

### Snapshot ordering

- [ ] Morning then afternoon import identifies all 13 recurring morning logical keys.
- [ ] Comparison retains 7 unchanged and 6 changed recurring records as verified by the regression utility.
- [ ] Importing the older morning snapshot after the afternoon snapshot preserves observations but does not roll current projections backward.
- [ ] Absence from a later snapshot never deletes/closes a source record.
- [ ] Every committed observation is traceable to batch/file/source row.
- [ ] Import creates source work groups/opportunity reviews and zero Amendment Records automatically.

## Opportunity Center and Audit Pro

- [ ] Opportunity Center displays real Client, Parent Task, Return Type, Tax Years, task count, Canopy status summary, source assignees, and source due dates.
- [ ] Canopy Status is visually/semantically distinct from TaxAce Workflow Status.
- [ ] Launch Amendment Audit Pro is active for operational roles.
- [ ] Audit Pro prepopulates source facts only.
- [ ] Staff can record Amendment Reason, documents received/needed, assessment, estimated tax impact when known, issue/risk notes, reviewer notes, recommendation, and priority.
- [ ] No Amendment Needed closes the review without creating an Amendment.
- [ ] Deferred preserves the review.
- [ ] Ready to Create Amendment enables the controlled creation path.
- [ ] Create Amendment requires confirmation of TaxAce-owned operational fields and creates the record transactionally.
- [ ] Viewer can read Audit Pro results but cannot edit/complete/create.

## Amendment operations

- [ ] Controlled Amendment creation creates Amendment, Tax Year Records, assignments, source links, and Activity History atomically.
- [ ] Reassignment synchronizes Amendment/Tax Year ownership as designed.
- [ ] Split moves only selected years and leaves at least one year on the source Amendment.
- [ ] Split preserves/copies approved source links and creates current assignments.
- [ ] Merge moves Tax Year coverage to the survivor, preserves source links, synchronizes surviving assignments, and ends source assignments.
- [ ] Cross-client, overlapping-year, merged-source, and Closed-record invalid mutations are rejected.
- [ ] Closure prerequisites are enforced.
- [ ] All Tax Year Records must be Closed before Amendment closure.
- [ ] Archive is a separate explicit action from closure.
- [ ] Material actions generate correlated Activity History events.

## Tracker, Workspace, Pipeline, Queues, Search, Saved Views

- [ ] Tracker search and filters work for workflow, tax year, return type, preparer, owner, priority, and aging.
- [ ] Assigned Preparer and Current Owner display user names rather than numeric IDs.
- [ ] Workspace Source context shows Parent Task, Return Type, source task/status/due/assignees and provenance separately from TaxAce-owned fields.
- [ ] Pipeline excludes Closed as an active column and displays approved TaxAce/source context.
- [ ] Viewer cannot drag/mutate Pipeline cards.
- [ ] Work Queues support My Queue, Unassigned, EA Review, and All Items.
- [ ] Global Search finds TaxAce Amendment Records and Canopy Source Work Groups.
- [ ] Saved Views restore approved filter/sort/column/grouping state.
- [ ] Viewer cannot create/delete Saved Views.

## Notifications

- [ ] Header bell is functional, not decorative.
- [ ] Notification center shows applicable assignment, overdue, client-signature, document-request, and EA-review alerts.
- [ ] Alert links open the affected Amendment Workspace.
- [ ] User notification preferences affect derived alerts.
- [ ] Email/SMS delivery is not implied or exposed as a working integration.

## Reporting and exports

- [ ] Reporting screens contain no hard-coded/demo operational metrics.
- [ ] Overview, department, preparer, EA, workflow aging, turnaround, tax-year, source, reasons, bottleneck, and productivity views handle empty data correctly.
- [ ] Source Analysis includes Return Type, Parent Task, Canopy Status, Tax Year, source assignee dimensions.
- [ ] Source Analysis includes Canopy import-batch provenance with filename/export timestamp/counts/status.
- [ ] CSV/XLSX/PDF operational exports respect the active search/workflow filters.
- [ ] Export includes Assigned Preparer.
- [ ] Export is stored privately and returned through a short-lived signed URL.
- [ ] Export Activity History records format, filters, and row count.
- [ ] Viewer can export without gaining mutation privileges.

## UI/accessibility

- [ ] Dark-sidebar/light-workspace TaxAce composition is preserved.
- [ ] Poppins and official TaxAce branding render without external Manus assets.
- [ ] No obsolete workflow labels appear.
- [ ] Empty, loading, error, and forbidden states are explicit.
- [ ] Key dialogs/buttons are keyboard reachable and focus-visible.
- [ ] Status meaning is not conveyed by color alone.
- [ ] Route lazy-loading works and direct deep links load correctly.

## Production security and deployment

- [ ] Production startup rejects placeholder/missing critical database/OAuth/storage/origin configuration.
- [ ] `APP_ORIGIN` and callback URI use HTTPS in production.
- [ ] Production responses include HSTS/CSP and baseline security headers.
- [ ] Authentication endpoints enforce request-rate limiting.
- [ ] State-changing tRPC requests enforce trusted/same-origin policy.
- [ ] Production S3-compatible bucket is private.
- [ ] `/health/live` returns 200 for a running process.
- [ ] `/health/ready` returns 200 with database connectivity and 503 when DB is unavailable.
- [ ] Runtime container runs as non-root user.
- [ ] Database migrations are applied before deployment traffic is switched.

## External configuration dependency

The following final test is intentionally outside source control:

- [ ] Complete Google Cloud OAuth client setup and perform a real browser sign-in with a provisioned TaxAce user.

Do not mark the production launch complete until that external authentication test passes.
