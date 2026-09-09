import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorPanel, formatDate, formatMoney, hasUiCapability, LoadingPanel, PageHeader, PriorityBadge, StatusBadge } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { WORKFLOW_TRANSITIONS } from "@shared/taxace";
import { Bookmark, ChevronDown, ChevronRight, Columns3, Download, Search, UserRoundPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const statuses = ["Investigation","With Client","In Progress","Ready for EA Review","EA Review","Waiting for Payment","Ready for Signature","Ready to File","Filed","Waiting on IRS / FTB","Accepted","Closed"] as const;
type WorkflowStatus = typeof statuses[number];
const priorities = ["High", "Medium", "Low"] as const;
const columnDefinitions = [
  ["client", "Client"],
  ["recordId", "Record ID"],
  ["priority", "Priority"],
  ["workflow", "Workflow Status"],
  ["taxYears", "Tax Year Records"],
  ["amendmentType", "Amendment Type"],
  ["nextAction", "Next Action"],
  ["estimatedTaxImpact", "Estimated Tax Impact"],
  ["documentation", "Documentation"],
  ["preparer", "Assigned Preparer"],
  ["eaReviewer", "EA Reviewer"],
  ["owner", "Current Owner"],
  ["updated", "Last Updated"],
  ["aging", "Aging"],
] as const;
type ColumnKey = typeof columnDefinitions[number][0];
type GroupKey = "none" | "workflow" | "preparer" | "owner";
const defaultColumns: ColumnKey[] = ["client","recordId","priority","workflow","taxYears","amendmentType","nextAction","estimatedTaxImpact","documentation","preparer","owner","updated","aging"];

function optionalNumber(value: string): number | undefined {
  if (!value || value === "all") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function initialColumns(params: URLSearchParams): ColumnKey[] {
  const requested = (params.get("columns") ?? "").split(",").filter(Boolean);
  const valid = requested.filter((value): value is ColumnKey => columnDefinitions.some(([key]) => key === value));
  return valid.length ? valid : defaultColumns;
}
function taxImpact(row: { amendment: { auditEstimatedTaxImpact: string | null; federalTaxImpact: string | null; californiaTaxImpact: string | null } }): number | null {
  const { auditEstimatedTaxImpact, federalTaxImpact, californiaTaxImpact } = row.amendment;
  if (federalTaxImpact !== null || californiaTaxImpact !== null) {
    return Number(federalTaxImpact ?? 0) + Number(californiaTaxImpact ?? 0);
  }
  return auditEstimatedTaxImpact === null ? null : Number(auditEstimatedTaxImpact);
}

export default function AmendmentTracker() {
  const params = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "all");
  const [taxYear, setTaxYear] = useState(params.get("taxYear") ?? "all");
  const [returnType, setReturnType] = useState(params.get("returnType") ?? "all");
  const [preparerId, setPreparerId] = useState(params.get("preparerId") ?? "all");
  const [ownerId, setOwnerId] = useState(params.get("ownerId") ?? "all");
  const [priority, setPriority] = useState(params.get("priority") ?? "all");
  const [agingMinDays, setAgingMinDays] = useState(params.get("agingMinDays") ?? "all");
  const [sortBy, setSortBy] = useState<"updated" | "priority" | "aging" | "client">((params.get("sort") as any) ?? "updated");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(params.get("direction") === "asc" ? "asc" : "desc");
  const [groupBy, setGroupBy] = useState<GroupKey>((["workflow","preparer","owner"].includes(params.get("group") ?? "") ? params.get("group") : "none") as GroupKey);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(initialColumns(params));
  const [page, setPage] = useState(positiveInt(params.get("page"), 1));
  const [pageSize, setPageSize] = useState(positiveInt(params.get("pageSize"), 25));
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirmAction, setConfirmAction] = useState<"priority" | "status" | "assign" | "archive" | null>(null);
  const [actionValue, setActionValue] = useState("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [sharedView, setSharedView] = useState(false);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const bootstrap = trpc.settings.bootstrap.useQuery();
  const users = trpc.settings.usersForAssignments.useQuery();
  const list = trpc.operationalViews.tracker.useQuery({
    search,
    status: status === "all" ? undefined : status as WorkflowStatus,
    includeClosed: status === "Closed",
    taxYear: optionalNumber(taxYear),
    returnType: returnType === "all" ? undefined : returnType,
    preparerId: optionalNumber(preparerId),
    ownerId: optionalNumber(ownerId),
    priority: priority === "all" ? undefined : priority as (typeof priorities)[number],
    agingMinDays: optionalNumber(agingMinDays),
  });
  const priorityMutation = trpc.amendments.setPriority.useMutation();
  const statusMutation = trpc.amendments.updateWorkflow.useMutation();
  const archiveMutation = trpc.amendments.archive.useMutation();
  const assignMutation = trpc.assignments.reassign.useMutation();
  const saveView = trpc.savedViews.save.useMutation({ onSuccess: () => { toast.success("Saved View created"); setSaveOpen(false); setViewName(""); utils.savedViews.list.invalidate(); }, onError: error => toast.error(error.message) });
  const exportMutation = trpc.reporting.export.useMutation({ onSuccess: result => { window.open(result.url, "_blank", "noopener,noreferrer"); toast.success("Export prepared"); }, onError: error => toast.error(error.message) });

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (status !== "all") next.set("status", status);
    if (taxYear !== "all") next.set("taxYear", taxYear);
    if (returnType !== "all") next.set("returnType", returnType);
    if (preparerId !== "all") next.set("preparerId", preparerId);
    if (ownerId !== "all") next.set("ownerId", ownerId);
    if (priority !== "all") next.set("priority", priority);
    if (agingMinDays !== "all") next.set("agingMinDays", agingMinDays);
    if (sortBy !== "updated") next.set("sort", sortBy);
    if (sortDirection !== "desc") next.set("direction", sortDirection);
    if (groupBy !== "none") next.set("group", groupBy);
    if (visibleColumns.join(",") !== defaultColumns.join(",")) next.set("columns", visibleColumns.join(","));
    if (page !== 1) next.set("page", String(page));
    if (pageSize !== 25) next.set("pageSize", String(pageSize));
    window.history.replaceState({}, "", `${window.location.pathname}${next.toString() ? `?${next}` : ""}`);
  }, [search,status,taxYear,returnType,preparerId,ownerId,priority,agingMinDays,sortBy,sortDirection,groupBy,visibleColumns,page,pageSize]);

  const rows = list.data ?? [];
  const operationalUsers = users.data?.filter(user => user.role !== "Viewer") ?? [];
  useEffect(() => {
    const availableIds = new Set(rows.map(row => row.amendment.id));
    setSelected(current => {
      const next = current.filter(id => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [rows]);
  const years = useMemo(() => Array.from(new Set(rows.flatMap(row => row.taxYears.map(year => year.taxYear)))).sort((a, b) => b - a), [rows]);
  const returnTypes = useMemo(() => Array.from(new Set(rows.flatMap(row => [row.amendment.amendmentType, ...row.sourceContexts.map(source => source.returnType)].filter(Boolean) as string[]))).sort(), [rows]);
  const sortedRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const sorted = [...rows].sort((a, b) => {
      if (sortBy === "client") return direction * a.client.clientName.localeCompare(b.client.clientName);
      if (sortBy === "priority") return direction * (({ High: 3, Medium: 2, Low: 1 }[a.amendment.priority] ?? 0) - ({ High: 3, Medium: 2, Low: 1 }[b.amendment.priority] ?? 0));
      if (sortBy === "aging") return direction * (a.ageDays - b.ageDays);
      return direction * (new Date(a.amendment.updatedAt).getTime() - new Date(b.amendment.updatedAt).getTime());
    });
    if (groupBy === "none") return sorted;
    const label = (row: typeof sorted[number]) => groupBy === "workflow" ? row.amendment.workflowStatus : groupBy === "preparer" ? row.assignedPreparerName || "Unassigned" : row.currentOwnerName || "Unassigned";
    return sorted.sort((a, b) => label(a).localeCompare(label(b)));
  }, [rows, sortBy, sortDirection, groupBy]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const pagedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const capabilities = bootstrap.data?.capabilities;
  const canSelect = ["assign","changePriority","coordinateWorkflow","archive"].some(capability => hasUiCapability(capabilities, capability));
  const allSelected = canSelect && pagedRows.length > 0 && pagedRows.every(row => selected.includes(row.amendment.id));
  const selectionLabel = selected.length === 1 ? "1 record selected" : `${selected.length} records selected`;
  const columnCount = visibleColumns.length + 1;
  const groupLabel = (row: typeof pagedRows[number]) => groupBy === "workflow" ? row.amendment.workflowStatus : groupBy === "preparer" ? row.assignedPreparerName || "Unassigned" : groupBy === "owner" ? row.currentOwnerName || "Unassigned" : "";
  const resetPage = () => setPage(1);
  const show = (column: ColumnKey) => visibleColumns.includes(column);
  const selectedRows = rows.filter(row => selected.includes(row.amendment.id));
  const commonStatusTargets = useMemo(() => {
    if (!selectedRows.length) return [] as WorkflowStatus[];
    return statuses.filter(target => selectedRows.every(row => (WORKFLOW_TRANSITIONS[row.amendment.workflowStatus] as readonly string[]).includes(target)));
  }, [selectedRows]);

  function beginBulkAction(action: "priority" | "status" | "assign" | "archive") {
    if (bulkApplying) return;
    if (action === "priority") setActionValue("High");
    else if (action === "status") setActionValue(commonStatusTargets[0] ?? "");
    else setActionValue("");
    setConfirmAction(action);
  }

  async function runBulk() {
    if (!confirmAction || bulkApplying) return;
    if (confirmAction === "status" && !commonStatusTargets.includes(actionValue as WorkflowStatus)) {
      toast.error("Select a workflow status that is valid for every selected Amendment Record.");
      return;
    }
    if (confirmAction === "assign" && !actionValue) return;
    const failures: string[] = [];
    setBulkApplying(true);
    try {
      for (const id of selected) {
        try {
          if (confirmAction === "priority") await priorityMutation.mutateAsync({ id, priority: actionValue as any });
          if (confirmAction === "status") await statusMutation.mutateAsync({ id, toStatus: actionValue as any, note: "Bulk status update" });
          if (confirmAction === "assign") await assignMutation.mutateAsync({ amendmentId: id, role: "Current Owner", assigneeId: Number(actionValue) });
          if (confirmAction === "archive") await archiveMutation.mutateAsync({ id });
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `Record ${id} failed`);
        }
      }
      await Promise.all([utils.operationalViews.tracker.invalidate(), utils.amendments.list.invalidate(), utils.reporting.dashboard.invalidate(), utils.activity.list.invalidate()]);
      setConfirmAction(null);
      setSelected([]);
      failures.length ? toast.error(`${failures.length} row(s) failed. ${failures[0]}`) : toast.success("Bulk action completed");
    } finally {
      setBulkApplying(false);
    }
  }

  if (list.isLoading) return <LoadingPanel label="Loading active Amendment Records" />;
  if (list.error) return <ErrorPanel message={list.error.message} retry={() => list.refetch()} />;
  return <div className="taxace-page max-w-none">
    <PageHeader eyebrow="Amendment Tracker" title="Active amendment operations" description="Search, filter, personalize, group, and act on persisted Amendment Records. Canopy source facts remain separate from TaxAce Workflow Status." actions={<><Button variant="outline" onClick={() => setColumnsOpen(true)}><Columns3 className="mr-2 h-4 w-4" />Columns</Button><Button variant="outline" onClick={() => setSaveOpen(true)}><Bookmark className="mr-2 h-4 w-4" />Save View</Button><Button variant="outline" disabled={exportMutation.isPending} onClick={() => exportMutation.mutate({ format: "xlsx", includeClosed: status === "Closed" })}><Download className="mr-2 h-4 w-4" />{exportMutation.isPending ? "Preparing…" : "Export"}</Button></>} />

    <Card className="taxace-card"><CardContent className="space-y-3 p-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_repeat(4,minmax(150px,190px))]">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => { setSearch(event.target.value); resetPage(); }} className="pl-9" placeholder="Client, record ID, reason, preparer, Parent Task, source assignee…" /></div>
        <Select value={status} onValueChange={value => { setStatus(value); resetPage(); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All active statuses</SelectItem>{statuses.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={taxYear} onValueChange={value => { setTaxYear(value); resetPage(); }}><SelectTrigger><SelectValue placeholder="Tax year" /></SelectTrigger><SelectContent><SelectItem value="all">All tax years</SelectItem>{years.map(item => <SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={returnType} onValueChange={value => { setReturnType(value); resetPage(); }}><SelectTrigger><SelectValue placeholder="Return type" /></SelectTrigger><SelectContent><SelectItem value="all">All return types</SelectItem>{returnTypes.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={priority} onValueChange={value => { setPriority(value); resetPage(); }}><SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger><SelectContent><SelectItem value="all">All priorities</SelectItem>{priorities.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Select value={preparerId} onValueChange={value => { setPreparerId(value); resetPage(); }}><SelectTrigger><SelectValue placeholder="Assigned Preparer" /></SelectTrigger><SelectContent><SelectItem value="all">All preparers</SelectItem>{operationalUsers.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email}</SelectItem>)}</SelectContent></Select>
        <Select value={ownerId} onValueChange={value => { setOwnerId(value); resetPage(); }}><SelectTrigger><SelectValue placeholder="Current Owner" /></SelectTrigger><SelectContent><SelectItem value="all">All owners</SelectItem>{operationalUsers.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email}</SelectItem>)}</SelectContent></Select>
        <Select value={agingMinDays} onValueChange={value => { setAgingMinDays(value); resetPage(); }}><SelectTrigger><SelectValue placeholder="Aging" /></SelectTrigger><SelectContent><SelectItem value="all">Any aging</SelectItem><SelectItem value="7">7+ days</SelectItem><SelectItem value="14">14+ days</SelectItem><SelectItem value="30">30+ days</SelectItem></SelectContent></Select>
        <Select value={sortBy} onValueChange={value => { setSortBy(value as typeof sortBy); resetPage(); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="updated">Last Updated</SelectItem><SelectItem value="priority">Priority</SelectItem><SelectItem value="aging">Aging</SelectItem><SelectItem value="client">Client Name</SelectItem></SelectContent></Select>
        <Select value={sortDirection} onValueChange={value => { setSortDirection(value as "asc" | "desc"); resetPage(); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="desc">Descending</SelectItem><SelectItem value="asc">Ascending</SelectItem></SelectContent></Select>
        <Select value={groupBy} onValueChange={value => { setGroupBy(value as GroupKey); resetPage(); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No grouping</SelectItem><SelectItem value="workflow">Group: Workflow</SelectItem><SelectItem value="preparer">Group: Preparer</SelectItem><SelectItem value="owner">Group: Owner</SelectItem></SelectContent></Select>
      </div>
      {selected.length && canSelect ? <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs"><span className="font-medium">{selectionLabel}</span>{hasUiCapability(capabilities,"assign") ? <Button size="sm" variant="outline" disabled={bulkApplying} onClick={() => beginBulkAction("assign")}><UserRoundPlus className="mr-1 h-3.5 w-3.5" />Assign</Button> : null}{hasUiCapability(capabilities,"changePriority") ? <Button size="sm" variant="outline" disabled={bulkApplying} onClick={() => beginBulkAction("priority")}>Change Priority</Button> : null}{hasUiCapability(capabilities,"coordinateWorkflow") ? <Button size="sm" variant="outline" disabled={bulkApplying} onClick={() => beginBulkAction("status")}>Update Status</Button> : null}{hasUiCapability(capabilities,"export") ? <Button size="sm" variant="outline" disabled={exportMutation.isPending || bulkApplying} onClick={() => exportMutation.mutate({ format: "xlsx", includeClosed: true, selectedIds: selected })}><Download className="mr-1 h-3.5 w-3.5" />{exportMutation.isPending ? "Preparing…" : "Export"}</Button> : null}{hasUiCapability(capabilities,"archive") ? <Button size="sm" variant="outline" disabled={bulkApplying} onClick={() => beginBulkAction("archive")}>Archive</Button> : null}</div> : null}
    </CardContent></Card>

    {rows.length === 0 ? <EmptyState title="No Amendment Records match this view" description="Adjust filters or create an Amendment Record from an eligible Opportunity Review." /> : <>
      <div className="taxace-table-wrap"><table className="taxace-table"><thead><tr><th>{canSelect ? <Checkbox checked={allSelected} onCheckedChange={checked => setSelected(checked ? pagedRows.map(row => row.amendment.id) : [])} aria-label="Select all records on this page" /> : "Preview"}</th>{show("client") ? <th>Client</th> : null}{show("recordId") ? <th>Record ID</th> : null}{show("priority") ? <th>Priority</th> : null}{show("workflow") ? <th>Workflow Status</th> : null}{show("taxYears") ? <th>Tax Year Records</th> : null}{show("amendmentType") ? <th>Amendment Type</th> : null}{show("nextAction") ? <th>Next Action</th> : null}{show("estimatedTaxImpact") ? <th>Estimated Tax Impact</th> : null}{show("documentation") ? <th>Documentation</th> : null}{show("preparer") ? <th>Assigned Preparer</th> : null}{show("eaReviewer") ? <th>EA Reviewer</th> : null}{show("owner") ? <th>Current Owner</th> : null}{show("updated") ? <th>Last Updated</th> : null}{show("aging") ? <th>Aging</th> : null}</tr></thead><tbody>{pagedRows.map((row, index) => {
        const isExpanded = expanded === row.amendment.id;
        const source = row.sourceContexts[0];
        const currentGroup = groupLabel(row);
        const previousGroup = index > 0 ? groupLabel(pagedRows[index - 1]) : null;
        const impact = taxImpact(row);
        return <>{groupBy !== "none" && currentGroup !== previousGroup ? <tr key={`group-${currentGroup}-${index}`} className="bg-muted/50"><td colSpan={columnCount} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{currentGroup}</td></tr> : null}<tr key={row.amendment.id}><td><div className="flex items-center gap-2">{canSelect ? <Checkbox checked={selected.includes(row.amendment.id)} onCheckedChange={checked => setSelected(current => checked ? Array.from(new Set([...current, row.amendment.id])) : current.filter(id => id !== row.amendment.id))} aria-label={`Select ${row.amendment.amendmentRecordId}`} /> : null}<button onClick={() => setExpanded(isExpanded ? null : row.amendment.id)} aria-label="Toggle quick preview">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></div></td>{show("client") ? <td onClick={() => setLocation(`/amendments/${row.amendment.id}`)} className="cursor-pointer font-medium">{row.client.clientName}</td> : null}{show("recordId") ? <td>{row.amendment.amendmentRecordId}</td> : null}{show("priority") ? <td><PriorityBadge priority={row.amendment.priority} /></td> : null}{show("workflow") ? <td><StatusBadge status={row.amendment.workflowStatus} /></td> : null}{show("taxYears") ? <td><div className="flex gap-1">{row.taxYears.map(year => <button key={year.id} onClick={() => setLocation(`/amendments/${row.amendment.id}?taxYear=${year.id}`)} className="rounded border bg-muted px-2 py-1 text-xs font-medium hover:border-primary">{year.taxYear}</button>)}</div></td> : null}{show("amendmentType") ? <td>{row.amendment.amendmentType || source?.returnType || "—"}</td> : null}{show("nextAction") ? <td className="max-w-xs truncate">{row.amendment.nextAction || "—"}</td> : null}{show("estimatedTaxImpact") ? <td>{impact === null ? "—" : formatMoney(impact)}</td> : null}{show("documentation") ? <td>{row.amendment.documentationStatus || "Not assessed"}</td> : null}{show("preparer") ? <td>{row.assignedPreparerName || "Unassigned"}</td> : null}{show("eaReviewer") ? <td>{row.assignedEaReviewerName || "Unassigned"}</td> : null}{show("owner") ? <td>{row.currentOwnerName || "Unassigned"}</td> : null}{show("updated") ? <td>{formatDate(row.amendment.updatedAt, true)}</td> : null}{show("aging") ? <td><span className={row.ageDays >= 30 ? "font-semibold text-red-700" : row.ageDays >= 14 ? "font-semibold text-amber-700" : ""}>{row.ageDays}d</span></td> : null}</tr>{isExpanded ? <tr key={`${row.amendment.id}-preview`}><td colSpan={columnCount} className="bg-muted/25"><div className="grid gap-4 p-3 md:grid-cols-5"><div><p className="text-xs font-semibold uppercase text-muted-foreground">Assessment</p><p className="mt-1 text-sm">{row.amendment.assessmentSummary || "Not recorded"}</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">Missing documents</p><p className="mt-1 text-sm">{row.amendment.documentsNeededSummary || "None recorded"}</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">EA Reviewer</p><p className="mt-1 text-sm">{row.assignedEaReviewerName || "Unassigned"}</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">Canopy Source Context</p><p className="mt-1 text-sm">{source ? `${source.parentTask} · ${source.returnType}` : "No linked source work group"}</p>{source?.statuses.length ? <p className="mt-1 text-xs text-muted-foreground">Canopy Status: {source.statuses.join(", ")}</p> : null}</div><div className="flex items-end"><Button size="sm" onClick={() => setLocation(`/amendments/${row.amendment.id}`)}>Open Workspace</Button></div></div></td></tr> : null}</>;
      })}</tbody></table></div>
      <div className="flex flex-col gap-3 rounded-lg border bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-muted-foreground">Showing {sortedRows.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, sortedRows.length)} of {sortedRows.length}</span><div className="flex items-center gap-2"><Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); }}><SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger><SelectContent>{[10,25,50,100].map(value => <SelectItem key={value} value={String(value)}>{value} rows</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</Button><span className="text-xs font-medium">Page {page} of {pageCount}</span><Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next</Button></div></div>
    </>}

    <Dialog open={Boolean(confirmAction)} onOpenChange={open => { if (!open && !bulkApplying) setConfirmAction(null); }}><DialogContent><DialogHeader><DialogTitle>Confirm bulk action</DialogTitle><DialogDescription>{selectionLabel}. Each row is re-authorized and validated on the server; failures are reported without bypassing workflow policy.</DialogDescription></DialogHeader>{confirmAction === "priority" ? <Select disabled={bulkApplying} value={actionValue} onValueChange={setActionValue}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{priorities.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select> : null}{confirmAction === "status" ? <div className="space-y-3">{commonStatusTargets.length ? <><Select disabled={bulkApplying} value={actionValue} onValueChange={setActionValue}><SelectTrigger><SelectValue placeholder="Select a valid workflow target" /></SelectTrigger><SelectContent>{commonStatusTargets.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Only statuses structurally valid for every selected record are shown. Payment, signature, EA review, Tax Year, and authorization prerequisites are still enforced by the server.</p></> : <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The selected records do not share a common valid next/return Workflow Status. Update them separately or select records at compatible workflow stages.</div>}</div> : null}{confirmAction === "assign" ? <Select disabled={bulkApplying} value={actionValue} onValueChange={setActionValue}><SelectTrigger><SelectValue placeholder="Select current owner" /></SelectTrigger><SelectContent>{operationalUsers.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email} · {user.role}</SelectItem>)}</SelectContent></Select> : null}<DialogFooter><Button variant="outline" disabled={bulkApplying} onClick={() => setConfirmAction(null)}>Cancel</Button><Button disabled={bulkApplying || (confirmAction === "assign" && !actionValue) || (confirmAction === "status" && (!actionValue || !commonStatusTargets.includes(actionValue as WorkflowStatus)))} onClick={runBulk}>{bulkApplying ? `Applying to ${selected.length}…` : `Confirm ${selectionLabel}`}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}><DialogContent><DialogHeader><DialogTitle>Amendment Tracker Columns</DialogTitle><DialogDescription>Choose the columns displayed in this view. Column choices are persisted in Saved Views.</DialogDescription></DialogHeader><div className="grid gap-2 sm:grid-cols-2">{columnDefinitions.map(([key,label]) => <label key={key} className="flex items-center gap-3 rounded-md border p-3 text-sm"><Checkbox checked={visibleColumns.includes(key)} onCheckedChange={checked => setVisibleColumns(current => checked ? Array.from(new Set([...current,key])) : current.length > 1 ? current.filter(item => item !== key) : current)} />{label}</label>)}</div><DialogFooter><Button variant="outline" onClick={() => setVisibleColumns(defaultColumns)}>Reset Default</Button><Button onClick={() => setColumnsOpen(false)}>Done</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent><DialogHeader><DialogTitle>Save Amendment Tracker View</DialogTitle><DialogDescription>Saved Views are private by default and retain filters, sorting, pagination, visible columns, and grouping.</DialogDescription></DialogHeader><div className="space-y-4"><div><label className="text-sm font-medium" htmlFor="view-name">View name</label><Input id="view-name" value={viewName} onChange={event => setViewName(event.target.value)} placeholder="My active EA review queue" /></div>{hasUiCapability(capabilities,"manageSharedViews") ? <label className="flex items-center gap-3 rounded-md border p-3 text-sm"><Checkbox checked={sharedView} onCheckedChange={checked => setSharedView(Boolean(checked))} />Share with authorized TaxAce users</label> : null}</div><DialogFooter><Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button><Button disabled={!viewName.trim() || saveView.isPending} onClick={() => saveView.mutate({ name: viewName, workspace: "Amendment Tracker", filters: { q: search, status, taxYear, returnType, preparerId, ownerId, priority, agingMinDays, page, pageSize }, visibleColumns, sortConfig: { field: sortBy, direction: sortDirection }, grouping: groupBy === "none" ? null : { field: groupBy }, shared: sharedView })}>{saveView.isPending ? "Saving…" : "Save View"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
