# TaxAce Amendment Management Dashboard — Full Functional Audit

**Audit date:** 2026-09-05  
**Branch:** `fix/codespaces-canopy-upload` / PR #7  
**Purpose:** Identify workflow, button, input, status, persistence, navigation, and auditability gaps before merge so acceptance can proceed by remediation batch instead of one defect at a time.

## Audit principles

1. Canopy source facts remain read-only provenance and never become TaxAce workflow data.
2. A button that represents a business event must collect the minimum data necessary to make that event true.
3. Status changes must be explicit, server-valid, attributable to a user/system actor, and visible in Activity History.
4. One-time/final actions lock or change state after success; repeatable actions remain available but show persistent history/status.
5. Workflow prerequisites must have a real UI action that allows the prerequisite to be recorded before the dependent transition.
6. Saved operational values must have clear pending, success, saved, and edit states.
7. No amendment-level monetary estimate may be silently duplicated across multiple Tax Year Records.

## Executive result

The core data model, authorization, import boundary, controlled amendment creation, persistence, assignments, activity history, reporting foundation, and server workflow validation are substantially sound. The largest defects found are **interaction-contract gaps**: several UI buttons were wired to shallow timestamp/status mutations instead of complete business actions, and the Workspace exposed only a subset of server-valid transitions.

The audit therefore classifies the tool as **functionally viable but not yet merge-ready**. The high-risk workflow blockers are being fixed on PR #7 before broader UX hardening.

---

## P0 — Workflow blockers / misleading business actions

| Finding | Risk | Status |
|---|---|---|
| Workspace exposed a single hard-coded `nextStatus`, hiding valid transitions such as Investigation → With Client, With Client → Investigation, and EA Review → In Progress. | Users cannot execute approved return/client-waiting paths even though server supports them. | **FIXED IN AUDIT BATCH** — governed `Change Workflow Status` control exposes only valid targets with human-readable action labels and optional transition note. |
| `Request Documents` only stamped `lastClientRequestAt`; no documents were selected and no checklist was created. | UI could claim documents were requested when no request scope existed. | **FIXED IN AUDIT BATCH** — governed request dialog requires at least one Document Type, supports an optional request note, persists `document_checklist`, updates documentation status, and writes Activity History. |
| Waiting for Payment → Ready for Signature requires payment confirmation but Workspace had no payment-confirmation control. | Workflow could dead-end at prerequisite validation. | **FIXED IN AUDIT BATCH** — `Confirm Payment` appears in Waiting for Payment and becomes a saved status after success. |
| Ready for Signature → Ready to File requires signature receipt but Workspace had no signature-received control. | Workflow could dead-end at prerequisite validation. | **FIXED IN AUDIT BATCH** — `Record Signature Received` appears in Ready for Signature and becomes a saved status after success. |
| With Client had no explicit way to record client response. | Client response metrics and operational follow-up could remain inaccurate. | **FIXED IN AUDIT BATCH** — `Record Client Response` added with user-attributed Activity History. |
| Milestone history used implementation labels such as `clientRequest milestone recorded`. | Audit trail is technically correct but unclear to staff/management. | **FIXED FOR NEW GOVERNED ACTIONS** — new document/payment/signature/client-response actions use human-readable Activity History labels. Legacy rows remain unchanged as historical facts. |

## P1 — Data-entry and workspace completeness

| Finding | Risk | Status |
|---|---|---|
| Assessment state persisted `estimatedRefundBalanceDue`, but Workspace did not render the field. | Stored capability existed but reviewer could not maintain it. | **FIXED IN AUDIT BATCH** — field is visible/editable in Assessment. |
| `documentationStatus` existed but was not visible in Assessment. | Users lacked a clear summary of document progress. | **FIXED IN AUDIT BATCH** — visible read-only status driven by the governed checklist. |
| Tax Year editor originally exposed only status/filing method and had weak save feedback. | Incomplete year-level processing and unclear persistence. | **PREVIOUSLY FIXED / ACCEPTED** — saved/edit state plus jurisdiction, federal/state statuses, dates, result, estimated/final impact. |
| Federal/State status used arbitrary text. | Inconsistent reporting/filter values. | **PREVIOUSLY FIXED / ACCEPTED** — controlled filing-status choices with jurisdiction awareness. |
| Audit Pro estimated tax impact did not carry into amendment operations. | Tracker/Workspace lost reviewer estimate. | **PREVIOUSLY FIXED / ACCEPTED** — amendment-level `auditEstimatedTaxImpact` with safe single/multi-year display rules. |
| Multi-year Audit Pro estimate could be mistaken for a per-year value. | Double-counting risk. | **PREVIOUSLY FIXED / ACCEPTED** — multi-year estimate stays amendment-level until explicitly allocated. |

## P1 — Cross-workspace navigation / action consistency

| Finding | Risk | Status |
|---|---|---|
| Dashboard Tax Year Distribution linked with `?year=` while Tracker reads `?taxYear=`. | Clicking chart did not apply intended filter. | **FIXED IN AUDIT BATCH**. |
| Global Search Canopy Source result links to `?sourceWorkGroupId=`, but Opportunity Center does not currently consume that parameter. | Search result can open the right workspace without focusing the selected source work group. | **OPEN — NEXT BATCH**. |
| Opportunity Center table does not surface all required review fields (Amendment Reason, Docs Received/Needed, Estimated Tax Impact, Recommendation) even though they exist in Audit Pro. | Managers cannot triage review state from the list without reopening each audit. | **OPEN — NEXT BATCH**. |

## P1 — Split / merge financial provenance

| Finding | Risk | Status |
|---|---|---|
| Split/Merge logic needs an explicit policy for amendment-level Audit Pro estimates and detailed federal/state impacts. | Copying or discarding an amendment-level estimate can cause duplicated or lost financial context. | **OPEN — REQUIRES DATA-POLICY FIX BEFORE SPLIT/MERGE ACCEPTANCE**. Do not silently duplicate a whole-amendment estimate across split records. |

## P2 — Button-state / destructive-action UX

| Area | Finding | Status |
|---|---|---|
| Settings → Aging Thresholds | Inputs remain permanently editable with plain `Save`; no durable Saved/Edit state. | **OPEN**. |
| Settings → Notifications | `Save Preferences` does not become a clear saved state. | **OPEN**. |
| Settings → Reference Lists | Add action needs clearer pending/success state and input reset. | **OPEN**. |
| Saved Views | Delete acts immediately; no confirmation and weak pending protection. | **OPEN**. |
| Amendment Tracker bulk actions | Confirmation exists, but execution needs a stronger `Applying…` lock and clearer valid-status guidance before server row failures. | **OPEN**. |
| Pipeline drag/drop | Server validation is authoritative and safe, but UI should constrain/highlight valid targets before drop instead of relying on post-drop rejection. | **OPEN**. |
| Opportunity Audit Pro Save Draft | Functional and persisted; could further improve dirty/saved indicator consistency. | **LOW PRIORITY OPEN**. |

## P2 — Reporting / supporting tools

| Area | Audit result |
|---|---|
| Activity History | Core append-only/read-only behavior is correct. New governed actions now use clearer labels. |
| Work Queues | Role-aware query and Workspace navigation are operational. Needs final acceptance after remaining workflow changes. |
| Reports/Exports | Pending/success handling exists and reports use persisted data. Final audit should verify exported fields after all new document/workflow data is stabilized. |
| Global Search | Amendment Record search is functional; Canopy-source deep-link targeting remains open. |
| Saved Views | Restore logic exists; deletion UX remains open. |

## P3 — Local/deployment hardening still required before production merge

1. Reconcile `.env.example` with `compose.yaml` local credentials.
2. Verify bootstrap-admin dotenv handling so beginners do not need manual environment export steps.
3. Expand readiness checks beyond database connectivity to storage/schema/auth/reference readiness.
4. Add MinIO to CI and exercise the real browser → Node → private storage import path.
5. Retain the same-origin import route for proxied/Codespaces deployments.
6. Validate restart/recovery path without destructive Docker volume commands.

## Acceptance sequence after this audit batch

1. Compile/typecheck current branch.
2. Test **Investigation → With Client** and **Investigation → In Progress** from the same Change Workflow dialog.
3. Test **With Client → Investigation** and **With Client → In Progress**.
4. Test Request Documents:
   - opening dialog does not change state;
   - cannot submit with zero selected documents;
   - select one or more document types + optional note;
   - success creates checklist rows and `Documents Requested` state;
   - Mark Received updates checklist/documentation status and Activity History.
5. Test Waiting for Payment prerequisite using `Confirm Payment`.
6. Test Ready for Signature prerequisite using `Record Signature Received`.
7. Test EA Review return path and forward approval path.
8. Remediate the remaining P1 items (Opportunity table/deep-link; split/merge financial provenance).
9. Remediate P2 consistency items in one batch.
10. Run full automated suite/build/migrations/standalone audit, then final acceptance before PR #7 merge.

## Merge recommendation

**Do not merge PR #7 yet.** Complete the acceptance sequence and P1 remediation first. P2 items may be completed in the same PR so the tool has consistent action semantics at merge time.
