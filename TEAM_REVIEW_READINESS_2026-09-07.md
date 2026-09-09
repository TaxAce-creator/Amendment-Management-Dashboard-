# TaxAce Amendment Management Dashboard — Team Review Readiness

**Prepared:** 2026-09-07  
**Branch:** `fix/codespaces-canopy-upload`  
**Pull Request:** #7  
**Purpose:** One final acceptance path for TaxAce team review after the consolidated defect-remediation and UI/UX hardening pass.

## Review posture

This branch is the acceptance branch for team review. It is intentionally **not merged to `main` yet**. Merge should occur only after the latest automated checks are green and the team completes the browser acceptance sequence below.

The Opportunity Center card-based review queue has already been browser-reviewed by TaxAce and the new UI/UX direction was approved on 2026-09-07.

## Defects remediated for final team review

### Canopy Task Import
- Browser uploads use the authenticated same-origin application endpoint instead of exposing a private MinIO/localhost URL to the browser.
- Import authorization, uploader ownership, finalized-batch protection, size limits, source validation, and private object storage remain enforced.
- File/timestamp/commit/cancel controls now lock consistently while an import action is pending.
- Cancelling an uncommitted batch clears the selected file, batch, timestamp, and validation preview cleanly.
- The default same-origin upload size now matches the configured 50 MB import limit.
- Browser acceptance already confirmed a real Canopy CSV reaches the Node application and private MinIO storage and validates without the prior localhost browser-network defect.
- Browser acceptance also confirmed an older source snapshot is classified as older and does not advance current source state.

### Origin / proxy security
- Proxied requests trust only the exact configured or forwarded public origin.
- Development no longer trusts every `*.app.github.dev` origin.
- Regression tests cover exact Codespaces origin acceptance and cross-Codespace rejection.

### Opportunity Center / Amendment Audit Pro
- Opportunity Center uses a responsive card review queue instead of a horizontally scrolling manager table.
- **Launch Amendment Audit Pro** is immediately visible for each review; users no longer need to scroll to a hidden Action column.
- Each card keeps Client, Parent Task, Return Type, Tax Years, Canopy state, internal audit summary, reviewer, priority, and status visible in a structured layout.
- Global Search Canopy-source links consume `sourceWorkGroupId` once and open the matching source work group / Opportunity Review without mutating review status merely by navigating.
- Audit Pro has a durable Saved / Unsaved changes state.
- Save Draft is disabled when there are no changes, shows Saving while pending, and prevents duplicate actions.
- Closing an edited Audit Pro form prompts before discarding unsaved work.
- Completed Ready to Create Amendment audits remain locked, and Amendment creation remains a separate deliberate action.
- Audit Pro remains an internal, human-led workflow; it does not generate a recommendation or automatically create an Amendment Record.

### Amendment Tracker
- Bulk Workflow Status choices are derived from the canonical `WORKFLOW_TRANSITIONS` map and show only targets structurally valid for every selected Amendment Record.
- If selected records have no common valid next/return status, the UI explains this and blocks the bulk transition.
- Server validation remains authoritative for payment, signature, EA review, Tax Year, closure, and authorization prerequisites.
- Bulk mutations lock while applying and show an explicit `Applying to N…` state.
- Row-level failures are reported without bypassing workflow rules.
- Selection is pruned when filters/results change so hidden or no-longer-visible records are not accidentally mutated.
- Viewer accounts are removed from operational preparer/owner assignment choices, matching server authorization.

### Pipeline
- Drag/drop exposes only approved structural workflow targets.
- Invalid/current destinations cannot accept a drop.
- Server-side business prerequisites remain authoritative.

### Split / merge financial provenance
- Tax Year Record estimated/final impacts remain attached to and move with their Tax Year Records.
- Amendment-level Audit Pro estimate, Federal impact, California impact, and Estimated Refund/Balance Due are **not copied or implicitly allocated** after a split or merge.
- Structural split/merge invalidates amendment-level aggregates and requires explicit recalculation before staff rely on totals.
- Previous amendment-level financial values are preserved in append-only Activity History as provenance.
- Regression tests cover aggregate invalidation, provenance snapshotting, and the required recalculation next action.

### Settings / Reports / Workspace navigation
- Operational tab navigation now wraps and keeps all destination names visible instead of requiring a horizontal navigation scrollbar.
- Aging thresholds have Saved / Edit / Unsaved / Saving states and Cancel behavior.
- Notification preferences show Saved / Unsaved / Saving states.
- Reference List additions disable invalid/pending submission and clear the successful input.
- Saved View deletion requires confirmation and locks duplicate actions while deletion is pending.

### Local setup / production hardening
- `.env.example` local credentials are reconciled with `compose.yaml` for MySQL and MinIO.
- Admin bootstrap loads `.env` in development.
- Production with an omitted `AUTH_MODE` defaults to OIDC rather than temporary test authentication; production should still explicitly set `AUTH_MODE=oidc`.
- `/health/ready` now checks both MySQL and the configured private S3/MinIO bucket and reports each dependency separately.
- Deployment guidance includes a non-destructive restart/recovery procedure and explicitly warns against deleting volumes during normal restart testing.

## Automated verification required before browser acceptance

The latest `Standalone CI` run for the **current PR head** must complete successfully with all of the following green:

1. Dependency installation
2. Standalone boundary audit
3. TypeScript check
4. Unit and contract tests
5. Production build
6. Database migration application
7. Static reference-data seed
8. Production container build

Do not treat an earlier successful run as acceptance for a newer branch head.

## Team browser acceptance sequence

### A. Authentication and role boundary
1. Sign in using the configured acceptance authentication mode.
2. Verify Admin, EA Reviewer, and Preparer can perform the same operational capability set.
3. Verify Viewer can view and export only.
4. As Viewer, confirm mutation controls for review, creation, editing, assignment, workflow movement, import, settings, split/merge, and close are unavailable or rejected.

### B. Canopy Task Import
Already observed during this acceptance session:
- a real Canopy CSV uploaded successfully through the same-origin Node route;
- validation recognized the real source structure;
- the tested 13-row snapshot produced 13 accepted rows, 0 conflicts, and 0 rejected rows;
- all 13 were correctly classified as an older snapshot because newer source state already existed.

Still test once before final sign-off:
1. Commit a current/newer controlled Canopy export.
2. Verify source observations and provenance persist.
3. Verify current projection advances only for newer source observations.
4. Verify eligible Opportunity Reviews are created/refreshed.
5. Verify no Amendment Record is created automatically.

### C. Global Search → Opportunity Center
1. Search for a Canopy source work group in Global Search.
2. Open the Canopy-source result.
3. Verify Opportunity Center opens the exact matching source work group / Opportunity Review.
4. Verify merely opening the search result does **not** change Opportunity Review status.
5. Verify the matching card is easy to identify and **Launch Amendment Audit Pro** is immediately accessible.

### D. Amendment Audit Pro
1. From an eligible Opportunity Review, click **Launch Amendment Audit Pro**.
2. Confirm Canopy source facts are read-only:
   - Client
   - Parent Task
   - Return Type
   - Tax Years
   - Tasks / Task Types
   - Canopy Statuses
   - Assignees
   - Due Dates
   - source provenance
3. Enter TaxAce review data:
   - Amendment Reason
   - Documents Received
   - Documents Needed
   - Assessment
   - Estimated Tax Impact if known
   - Risk / Issue Notes
   - Reviewer Notes
   - Recommendation
   - Priority
4. Confirm the UI changes from Saved → Unsaved changes after editing.
5. Save Draft and verify Saving → Saved.
6. Edit again, attempt to close, and verify the discard-unsaved confirmation appears.
7. Reopen the saved draft and verify persistence.
8. Complete separate examples as:
   - No Amendment Needed
   - Deferred
   - Ready to Create Amendment
9. Verify the first two outcomes do not create an Amendment Record.
10. Verify Ready to Create Amendment locks the completed Audit Pro and still requires the separate controlled **Create Amendment** action.

### E. Controlled Amendment creation
1. Create an Amendment Record from a completed Ready to Create Amendment audit.
2. Confirm Tax Years, jurisdiction, preparer, current owner, optional EA Reviewer, priority, reason, and assessment.
3. Confirm Viewer is not offered as an operational assignee.
4. Confirm the created record opens in the Amendment Workspace.
5. Confirm Audit Pro estimated impact is carried as amendment-level context without being duplicated into multiple Tax Year Records.

### F. Workspace document and workflow actions
1. Edit and save the Assessment fields.
2. Use Track Required Documents; verify at least one Document Type is required.
3. Mark requested documents Received or Not Applicable after manual Canopy verification and verify documentation status/history.
4. Test approved workflow paths and return paths, including:
   - Investigation → With Client
   - Investigation → In Progress
   - With Client → Investigation
   - With Client → In Progress
   - In Progress → Ready for EA Review
   - EA Review return path
   - EA Review forward path
5. In Waiting for Payment, use **Confirm Payment** before moving to Ready for Signature.
6. In Ready for Signature, use **Record Signature Received** before moving to Ready to File.
7. Complete filing / acceptance progression.
8. Verify Closed is rejected until every Tax Year Record is Closed.
9. Verify Activity History records human-readable, attributable actions.
10. Verify Workspace tabs remain fully visible/wrapped without a separate horizontal navigation scrollbar.

### G. Amendment Tracker
1. Select one record and verify bulk actions are available to operational roles only.
2. Select records at compatible workflow stages; open Update Status and verify only common structurally valid next/return statuses are offered.
3. Select incompatible workflow stages and verify the UI reports that there is no common valid target.
4. Start a bulk action and verify controls lock with an Applying state until processing completes.
5. Change filters after selecting records and verify records removed from the result set are also removed from the bulk selection.
6. Verify Viewer users do not appear in operational assignment choices.

### H. Pipeline
1. Drag an Amendment Record.
2. Confirm only approved next/return workflow columns are highlighted as valid targets.
3. Confirm invalid/skipped workflow columns cannot accept the drop.
4. For a structurally valid target with an unmet business prerequisite, confirm the server still rejects the move with a clear message.

### I. Split financial-provenance test
Use a multi-year Amendment Record that has amendment-level financial values and Tax Year-level impacts.

1. Split one or more, but not all, Tax Year Records to a new Amendment Record.
2. Confirm selected Tax Year Records move to the new record and unselected years remain on the source.
3. Confirm each Tax Year Record retains its own estimated/final impact.
4. Confirm the source Amendment Record's amendment-level Audit Pro estimate, Federal impact, California impact, and Estimated Refund/Balance Due are cleared.
5. Confirm the new Amendment Record does **not** inherit those whole-amendment totals.
6. Confirm both resulting records require recalculation in Next Action.
7. Confirm Activity History preserves the source's pre-split amendment-level values and states the financial-provenance policy.

### J. Merge financial-provenance test
Use two active Amendment Records for the same client with non-overlapping Tax Years.

1. Merge the source into the target.
2. Confirm overlapping-year merges are rejected.
3. Confirm source Tax Year Records move to the target and retain their year-level impacts.
4. Confirm the target's amendment-level Audit Pro estimate, Federal impact, California impact, and Estimated Refund/Balance Due are cleared rather than summed or copied.
5. Confirm the historical merged source does not present stale amendment-level aggregates as current totals.
6. Confirm Activity History preserves both source and target pre-merge aggregate values and identifies the surviving target.
7. Recalculate and explicitly save the surviving amendment-level totals before relying on them operationally.

### K. Settings / Saved Views / Reports
1. Verify Settings tabs are all visible/wrapped without horizontal tab navigation.
2. Edit an aging threshold; verify Unsaved → Saving → Saved states and Cancel behavior.
3. Change Notification Preferences; verify Unsaved → Saving → Saved states.
4. Add a Reference List value; verify pending protection and input reset after success.
5. Delete a Saved View; verify confirmation is required and duplicate deletion is locked.
6. Verify Reports tabs are all visible/wrapped.
7. Verify Work Queues navigate to the correct Amendment Workspace.
8. Verify Reports and exports reflect persisted workflow/document/financial data.
9. Verify closed and active records are represented according to selected filters.
10. Spot-check Activity History after review, document, workflow, split, and merge actions.

### L. Health / restart check in acceptance environment
1. Verify `/health/live` returns 200.
2. Verify `/health/ready` returns 200 with both `database: ready` and `storage: ready` while MySQL and MinIO are running.
3. Restart the application/services without deleting volumes.
4. Verify previously persisted records and Activity History remain present.

## Acceptance evidence to capture

For each failed step, capture:
- page / workspace
- user role
- Amendment Record ID or Canopy source work-group context
- exact action taken
- exact displayed error
- screenshot if visual/layout-related
- expected result
- actual result

For each passed critical path, record the tester name and date.

## Remaining production/go-live gates

The following are external or target-environment checks and remain intentionally separate from code-complete team functional review:

- configure real production MySQL and private object storage with production-only credentials;
- configure actual Google Workspace OIDC client credentials and exact production callback;
- verify real `@taxacebsi.com` Google Workspace sign-in in the production/staging target;
- verify Viewer behavior with a real Viewer account in the target environment;
- repeat protected upload/download against the final production/staging private object store;
- verify production `/health/live` and `/health/ready`;
- complete the non-destructive restart/recovery exercise in the final target environment;
- confirm managed database backup/restore and object-storage retention/versioning policy;
- complete the final verification checklist.

These are not reasons to reopen already-remediated application-code defects unless target-environment testing identifies a new defect.

## Merge gate

**Do not merge PR #7 into `main` solely because automated CI is green.** Merge only after the above team acceptance path is completed and any newly discovered P0/P1 functional defect is resolved or explicitly dispositioned.
