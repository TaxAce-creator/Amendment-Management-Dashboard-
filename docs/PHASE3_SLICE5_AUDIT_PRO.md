# Phase 3 Slice 5 — Amendment Audit Pro

## Purpose

Amendment Audit Pro is an internal, human-driven TaxAce workflow launched from Opportunity Center. It converts a source-linked Opportunity Review into a documented decision and, only when approved by staff, a controlled Amendment Record creation transaction.

Audit Pro is not an AI recommendation engine and does not connect to Canopy APIs, Canopy document storage, IRS/FTB systems, QuickBooks, or any external tax-document service.

## Workflow

```text
Canopy Task Import
  -> Opportunity Center
  -> Launch Amendment Audit Pro
  -> Structured human review
  -> Decision
       -> No Amendment Needed
       -> Deferred
       -> Ready to Create Amendment
            -> Controlled Create Amendment
            -> Amendment Workspace
```

## Source context

Audit Pro reads source facts from the Slice 4 Canopy provenance model. Source values are read-only in Audit Pro and remain distinct from TaxAce operational fields.

Displayed source context includes:

- source Client name;
- Parent Task;
- Return Type;
- Tax Years;
- current Canopy task titles and Task Types;
- Canopy Status values;
- source task Due Dates;
- source Assignees;
- Pinned values;
- source batch ID;
- original filename;
- source export timestamp;
- parser version;
- source row numbers from the latest committed snapshot.

Canopy Status never becomes TaxAce Workflow Status. Canopy Due Date never becomes an Amendment Record Due Date.

## Human-entered Audit Pro fields

Existing `opportunity_reviews` fields remain the source of truth for:

- Recommendation;
- Priority;
- Amendment Reason;
- Documents Received;
- Documents Needed;
- Amendment Assessment;
- Estimated Tax Impact;
- Reviewer Notes.

Slice 5 adds the one-to-one `opportunity_audit_details` table for Audit Pro-specific values:

- Risk / Issue Notes;
- Audit Started At;
- Audit Completed At;
- last updating TaxAce user.

## Outcomes

### No Amendment Needed

- completes the Audit Pro review;
- deactivates the Opportunity Review;
- preserves the review and audit detail history;
- creates no Amendment Record.

### Deferred

- completes the current Audit Pro decision;
- deactivates the current Opportunity Review while preserving all review data;
- creates no Amendment Record.

### Ready to Create Amendment

- requires a human-entered Amendment Reason;
- requires a human-entered Amendment Assessment;
- requires a Recommendation;
- keeps the source-linked Opportunity Review available for controlled creation;
- does not itself create an Amendment Record.

## Controlled Amendment creation

`auditPro.createAmendment` is the only Amendment creation procedure exposed through the public application router after Slice 5.

Creation requires:

- an active Opportunity Review;
- Opportunity Status exactly `Ready to Create Amendment`;
- confirmed Amendment Reason;
- confirmed Amendment Assessment;
- Amendment Type / Return Type;
- at least one Tax Year;
- TaxAce jurisdiction for each Tax Year;
- Assigned Preparer;
- Current Owner;
- optional EA Reviewer;
- Priority.

When the Opportunity Review has a linked Canopy work group, every selected Tax Year must exist in that source work group. Existing active Tax Year coverage is rejected.

The creation transaction atomically creates:

1. one Amendment Record;
2. independent Tax Year Records;
3. current assignment rows;
4. one `amendment_source_links` row when source provenance exists;
5. final Opportunity Review state;
6. Audit Pro detail completion state;
7. correlated Activity History events.

If any part fails, the transaction fails as a unit.

## Roles

| Role | Audit Pro access |
|---|---|
| Admin | Full |
| EA Reviewer | Full |
| Preparer | Full |
| Viewer | View only |

Server capability enforcement is the security boundary. UI hiding/disabling is not relied upon for authorization.

## Non-negotiable invariants

- Audit Pro does not generate amendment recommendations.
- Audit Pro never automatically creates an Amendment Record.
- No Canopy write-back or synchronization exists.
- Source facts remain traceable to imported batch/file/row provenance.
- Viewer cannot launch, save, complete, or create.
- `No Amendment Needed` and `Deferred` create zero Amendment Records.
- `Ready to Create Amendment` creates zero Amendment Records until the separate controlled creation confirmation succeeds.
- Controlled creation links the Amendment Record back to its Canopy source work group when one exists.
- Material Audit Pro actions are written to append-only Activity History.

## Verification gates

Before Slice 5 is merged to `main`, verify:

```bash
pnpm check
pnpm test
pnpm build
```

Then apply the incremental migration to an existing Slice 4 database:

```bash
pnpm db:migrate
```

Acceptance must also verify:

- `opportunity_audit_details` exists with a unique Opportunity Review relationship;
- Viewer mutations are rejected server-side;
- Launch records Audit Pro start state and Activity History;
- Save Draft persists human-entered fields without completing the review;
- No Amendment Needed closes review with zero amendments;
- Deferred closes review with zero amendments;
- Ready to Create Amendment does not create an amendment;
- controlled creation creates one amendment plus source link and selected Tax Year Records atomically;
- source Tax Year validation rejects years outside the linked work group;
- legacy `opportunities.createAmendment` is no longer exposed by `appRouter`.
