import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tracker = readFileSync(new URL("../client/src/pages/AmendmentTracker.tsx", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("../client/src/pages/Pipeline.tsx", import.meta.url), "utf8");
const search = readFileSync(new URL("../client/src/pages/GlobalSearch.tsx", import.meta.url), "utf8");
const queues = readFileSync(new URL("../client/src/pages/WorkQueues.tsx", import.meta.url), "utf8");
const savedViews = readFileSync(new URL("./routers/savedViews.ts", import.meta.url), "utf8");
const operationalViews = readFileSync(new URL("./routers/operationalViews.ts", import.meta.url), "utf8");
const appRouter = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Slice 6 operational read-model contract", () => {
  it("uses the enriched operational views for Tracker, Search, and Work Queues", () => {
    expect(tracker).toContain("trpc.operationalViews.tracker.useQuery");
    expect(search).toContain("trpc.operationalViews.search.useQuery");
    expect(queues).toContain("trpc.operationalViews.workQueue.useQuery");
    expect(operationalViews).toContain("sourceContextByAmendment");
    expect(operationalViews).toContain("assignedPreparerName");
    expect(operationalViews).toContain("assignedEaReviewerName");
    expect(operationalViews).toContain("currentOwnerName");
  });

  it("keeps Canopy source facts distinct in Global Search", () => {
    expect(search).toContain("Canopy Source Work Groups");
    expect(search).toContain("Imported source context only — not Amendment Records");
    expect(search).toContain("/opportunities?sourceWorkGroupId=");
  });
});

describe("Slice 6 Tracker personalization contract", () => {
  it("restores filters, pagination, columns, sort direction, and grouping from URL state", () => {
    expect(tracker).toContain('params.get("columns")');
    expect(tracker).toContain('params.get("page")');
    expect(tracker).toContain('params.get("pageSize")');
    expect(tracker).toContain('params.get("direction")');
    expect(tracker).toContain('params.get("group")');
    expect(tracker).toContain('next.set("columns"');
    expect(tracker).toContain('next.set("page"');
    expect(tracker).toContain('next.set("pageSize"');
  });

  it("saves URL-compatible Tracker state instead of stale field names", () => {
    expect(tracker).toContain("filters: { q: search, status, taxYear, returnType, preparerId, ownerId, priority, agingMinDays, page, pageSize }");
    expect(tracker).toContain("visibleColumns");
    expect(tracker).toContain("direction: sortDirection");
    expect(tracker).toContain('groupBy === "none" ? null : { field: groupBy }');
  });

  it("does not label the refund/balance field as Estimated Tax Impact", () => {
    expect(tracker).toContain("federalTaxImpact");
    expect(tracker).toContain("californiaTaxImpact");
    expect(tracker).not.toContain("formatMoney(row.amendment.estimatedRefundBalanceDue)");
  });
});

describe("Slice 6 Viewer read-only contract", () => {
  it("prevents Viewer workflow dragging in Pipeline", () => {
    expect(pipeline).toContain('hasUiCapability(bootstrap.data?.capabilities, "coordinateWorkflow")');
    expect(pipeline).toContain("draggable={canCoordinate}");
    expect(pipeline).toContain("if (!canCoordinate) return;");
  });

  it("routes Saved View writes through a capability that Viewer does not have", () => {
    expect(appRouter).toContain('from "./routers/savedViews.js"');
    expect(savedViews).toContain('requireCapability(ctx.user, "view")');
    expect(savedViews.match(/requireCapability\(ctx\.user, "manageSharedViews"\)/g)?.length).toBe(2);
  });
});
