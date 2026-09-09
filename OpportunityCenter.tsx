import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  ErrorPanel,
  formatDate,
  formatMoney,
  hasUiCapability,
  LoadingPanel,
  MetricCard,
  PageHeader,
  PriorityBadge,
  StatusBadge,
} from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, FileSearch, Import, Plus, Save, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const opportunityStatuses = ["Pending Review", "Under Review", "Ready to Create Amendment", "No Amendment Needed", "Deferred"] as const;
const recommendations = ["Recommend Amendment", "Additional Review Required", "Awaiting Documentation", "No Amendment Recommended"] as const;
const outcomes = ["No Amendment Needed", "Deferred", "Ready to Create Amendment"] as const;
const jurisdictions = ["Federal", "California", "Federal & California", "Other State"] as const;

function sanitizeUsdInput(value: string): string | null {
  const normalized = value.replace(/[$,\s]/g, "");
  if (normalized === "" || normalized === "-") return normalized;
  return /^-?\d*(?:\.\d{0,2})?$/.test(normalized) ? normalized : null;
}

type AuditForm = {
  recommendation: string;
  priority: string;
  amendmentReasonSummary: string;
  documentsReceivedSummary: string;
  documentsNeededSummary: string;
  amendmentAssessment: string;
  riskIssueNotes: string;
  reviewNotes: string;
  estimatedTaxImpact: string;
};

const emptyAudit: AuditForm = {
  recommendation: "none",
  priority: "Medium",
  amendmentReasonSummary: "",
  documentsReceivedSummary: "",
  documentsNeededSummary: "",
  amendmentAssessment: "",
  riskIssueNotes: "",
  reviewNotes: "",
  estimatedTaxImpact: "",
};

function auditFormFromContext(data: any): AuditForm {
  return {
    recommendation: data.opportunity.recommendation ?? "none",
    priority: data.opportunity.priority,
    amendmentReasonSummary: data.opportunity.amendmentReasonSummary ?? "",
    documentsReceivedSummary: data.opportunity.documentsReceivedSummary ?? "",
    documentsNeededSummary: data.opportunity.documentsNeededSummary ?? "",
    amendmentAssessment: data.opportunity.amendmentAssessment ?? "",
    riskIssueNotes: data.auditDetail?.riskIssueNotes ?? "",
    reviewNotes: data.opportunity.reviewNotes ?? "",
    estimatedTaxImpact: data.opportunity.estimatedTaxImpact == null ? "" : String(data.opportunity.estimatedTaxImpact),
  };
}

function requestedSourceWorkGroupId(): number | null {
  const raw = new URLSearchParams(window.location.search).get("sourceWorkGroupId");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export default function OpportunityCenter() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingDeepLinkSourceWorkGroupId, setPendingDeepLinkSourceWorkGroupId] = useState<number | null>(() => requestedSourceWorkGroupId());
  const [focusedSourceWorkGroupId, setFocusedSourceWorkGroupId] = useState<number | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [audit, setAudit] = useState<AuditForm>(emptyAudit);
  const [auditBaseline, setAuditBaseline] = useState<AuditForm>(emptyAudit);
  const [years, setYears] = useState("");
  const [jurisdiction, setJurisdiction] = useState<(typeof jurisdictions)[number]>("Federal & California");
  const [amendmentType, setAmendmentType] = useState("");
  const [preparerId, setPreparerId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [eaReviewerId, setEaReviewerId] = useState("none");
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const list = trpc.auditPro.list.useQuery({ search, status: statusFilter === "all" ? undefined : statusFilter as any });
  const bootstrap = trpc.settings.bootstrap.useQuery();
  const users = trpc.settings.usersForAssignments.useQuery();
  const context = trpc.auditPro.context.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== null },
  );

  const capabilities = bootstrap.data?.capabilities;
  const canReview = hasUiCapability(capabilities, "reviewOpportunity");
  const canCreate = hasUiCapability(capabilities, "createAmendment");
  const canImport = hasUiCapability(capabilities, "import");
  const auditReadyForCreation = context.data?.opportunity.opportunityStatus === "Ready to Create Amendment";
  const auditDirty = useMemo(() => JSON.stringify(audit) !== JSON.stringify(auditBaseline), [audit, auditBaseline]);

  const refresh = async () => {
    await Promise.all([
      utils.auditPro.list.invalidate(),
      utils.auditPro.context.invalidate(),
      utils.opportunities.list.invalidate(),
      utils.reporting.dashboard.invalidate(),
      utils.activity.list.invalidate(),
    ]);
  };

  const launch = trpc.auditPro.launch.useMutation({
    onSuccess: async () => {
      await refresh();
      setAuditOpen(true);
    },
    onError: error => toast.error(error.message),
  });
  const save = trpc.auditPro.save.useMutation({
    onSuccess: async () => {
      toast.success("Amendment Audit Pro draft saved");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const complete = trpc.auditPro.complete.useMutation({
    onSuccess: async (_result, variables) => {
      toast.success(`Amendment Audit Pro completed: ${variables.outcome}`);
      await refresh();
      if (variables.outcome !== "Ready to Create Amendment") {
        setAuditOpen(false);
        setSelectedId(null);
      }
    },
    onError: error => toast.error(error.message),
  });
  const create = trpc.auditPro.createAmendment.useMutation({
    onSuccess: async result => {
      toast.success("Amendment Record created from Amendment Audit Pro");
      setCreateOpen(false);
      setAuditOpen(false);
      await Promise.all([
        refresh(),
        utils.amendments.list.invalidate(),
      ]);
      setLocation(`/amendments/${result.id}`);
    },
    onError: error => toast.error(error.message),
  });
  const auditMutating = save.isPending || complete.isPending;

  useEffect(() => {
    const data = context.data;
    if (!data) return;
    const nextAudit = auditFormFromContext(data);
    setAudit(nextAudit);
    setAuditBaseline(nextAudit);
    setYears(data.source?.taxYears.join(", ") ?? "");
    setAmendmentType(data.source?.workGroup.returnType ?? "");
  }, [context.data]);

  const rows = list.data ?? [];

  useEffect(() => {
    if (!pendingDeepLinkSourceWorkGroupId || !list.data) return;
    const sourceWorkGroupId = pendingDeepLinkSourceWorkGroupId;
    const row = list.data.find(item => item.sourceWorkGroup?.id === sourceWorkGroupId);
    setPendingDeepLinkSourceWorkGroupId(null);
    window.history.replaceState({}, "", "/opportunities");

    if (!row) {
      toast.error("The selected Canopy source work group has no active Opportunity Review.");
      return;
    }

    // A search deep-link is navigation only. Do not mutate review status merely by
    // opening the source work group from Global Search.
    setFocusedSourceWorkGroupId(sourceWorkGroupId);
    setSelectedId(row.opportunity.id);
    setAuditOpen(true);
    requestAnimationFrame(() => {
      document.getElementById(`source-work-group-${sourceWorkGroupId}`)?.scrollIntoView({ block: "center" });
    });
  }, [pendingDeepLinkSourceWorkGroupId, list.data]);

  const summary = useMemo(
    () => ({
      pending: rows.filter(row => row.opportunity.opportunityStatus === "Pending Review").length,
      under: rows.filter(row => row.opportunity.opportunityStatus === "Under Review").length,
      ready: rows.filter(row => row.opportunity.opportunityStatus === "Ready to Create Amendment").length,
      high: rows.filter(row => row.opportunity.priority === "High").length,
    }),
    [rows],
  );

  function openAudit(row: any) {
    setSelectedId(row.opportunity.id);
    setFocusedSourceWorkGroupId(row.sourceWorkGroup?.id ?? null);
    if (canReview && row.opportunity.opportunityStatus !== "Ready to Create Amendment") {
      launch.mutate({ id: row.opportunity.id });
    } else {
      setAuditOpen(true);
    }
  }

  function closeAudit() {
    if (auditMutating) return;
    if (auditDirty && !auditReadyForCreation && !window.confirm("Discard unsaved Amendment Audit Pro changes?")) return;
    setAuditOpen(false);
    if (!createOpen) setSelectedId(null);
  }

  function auditPayload() {
    const estimatedTaxImpact = audit.estimatedTaxImpact.trim();
    return {
      recommendation: audit.recommendation === "none" ? null : audit.recommendation as any,
      priority: audit.priority as any,
      amendmentReasonSummary: audit.amendmentReasonSummary.trim() || null,
      documentsReceivedSummary: audit.documentsReceivedSummary.trim() || null,
      documentsNeededSummary: audit.documentsNeededSummary.trim() || null,
      amendmentAssessment: audit.amendmentAssessment.trim() || null,
      riskIssueNotes: audit.riskIssueNotes.trim() || null,
      reviewNotes: audit.reviewNotes.trim() || null,
      estimatedTaxImpact: estimatedTaxImpact && estimatedTaxImpact !== "-" ? Number(estimatedTaxImpact) : null,
    };
  }

  if (list.isLoading) return <LoadingPanel label="Loading Opportunity Reviews" />;
  if (list.error) return <ErrorPanel message={list.error.message} retry={() => list.refetch()} />;

  return <div className="taxace-page max-w-[1800px]">
    <PageHeader
      eyebrow="Opportunity Center"
      title="Review amendment opportunities"
      description="Evaluate real Canopy task-source work groups with TaxAce Amendment Audit Pro before an Amendment Record exists."
      actions={canImport ? <Button variant="outline" onClick={() => setLocation("/settings?tab=canopy-import")}><Import className="mr-2 h-4 w-4" />Canopy Task Import</Button> : undefined}
    />

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="Pending Review" value={summary.pending} />
      <MetricCard label="Under Review" value={summary.under} />
      <MetricCard label="Ready to Create" value={summary.ready} />
      <MetricCard label="High Priority" value={summary.high} />
    </section>

    <Card className="taxace-card">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} className="pl-9" placeholder="Search client or TaxAce Client Record ID" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[240px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Opportunity Statuses</SelectItem>{opportunityStatuses.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
      </CardContent>
    </Card>

    {rows.length === 0 ? (
      <EmptyState
        title="No active Opportunity Reviews"
        description="Committed Canopy Task Imports create source-linked Pending Review opportunities. No Amendment Record is created until Amendment Audit Pro reaches a controlled creation decision."
        action={canImport ? <Button onClick={() => setLocation("/settings?tab=canopy-import")}>Open Canopy Task Import</Button> : undefined}
      />
    ) : (
      <section className="space-y-3" aria-label="Opportunity review queue">
        <div className="flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Opportunity Review Queue</h2>
            <p className="text-sm text-muted-foreground">Each review keeps the Audit Pro action and all decision-critical labels visible without horizontal table navigation.</p>
          </div>
          <p className="text-xs font-medium text-muted-foreground">{rows.length} active {rows.length === 1 ? "review" : "reviews"}</p>
        </div>

        {rows.map(row => {
          const sourceWorkGroupId = row.sourceWorkGroup?.id ?? null;
          const focused = sourceWorkGroupId !== null && sourceWorkGroupId === focusedSourceWorkGroupId;
          const actionLabel = row.opportunity.opportunityStatus === "Ready to Create Amendment"
            ? "Open Completed Audit"
            : canReview
              ? "Launch Amendment Audit Pro"
              : "View Amendment Audit Pro";

          return <Card
            id={sourceWorkGroupId ? `source-work-group-${sourceWorkGroupId}` : undefined}
            key={row.opportunity.id}
            className={`taxace-card overflow-hidden ${focused ? "ring-2 ring-primary/30" : ""}`}
          >
            <CardContent className="p-0">
              <div className="flex flex-col gap-4 border-b bg-muted/10 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{row.client.clientName}</h3>
                    <StatusBadge status={row.opportunity.opportunityStatus} />
                    <PriorityBadge priority={row.opportunity.priority} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">TaxAce Client Record ID: {row.client.clientId}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {row.sourceWorkGroup?.parentTask ?? "No source work group"}
                    {row.sourceWorkGroup?.returnType ? ` · ${row.sourceWorkGroup.returnType}` : ""}
                    {row.sourceSummary?.taxYears.length ? ` · Tax Year${row.sourceSummary.taxYears.length > 1 ? "s" : ""} ${row.sourceSummary.taxYears.join(", ")}` : ""}
                  </p>
                </div>

                <div className="flex w-full shrink-0 flex-col gap-2 lg:w-auto lg:min-w-[260px]">
                  <Button
                    className="w-full whitespace-normal text-center leading-5"
                    variant={row.opportunity.opportunityStatus === "Ready to Create Amendment" || !canReview ? "outline" : "default"}
                    onClick={() => openAudit(row)}
                  >
                    <FileSearch className="mr-2 h-4 w-4 shrink-0" />
                    {actionLabel}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground lg:text-right">
                    Internal Reviewer: <span className="font-medium text-foreground">{row.reviewerName || "Unassigned"}</span>
                  </p>
                </div>
              </div>

              <div className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-3">
                <ReviewSection title="Canopy Source">
                  <ReviewFact label="Parent Task" value={row.sourceWorkGroup?.parentTask ?? "No source work group"} />
                  <div className="grid grid-cols-2 gap-3">
                    <ReviewFact label="Return Type" value={row.sourceWorkGroup?.returnType ?? "—"} />
                    <ReviewFact label="Tax Years" value={row.sourceSummary?.taxYears.join(", ") || "—"} />
                  </div>
                  <ReviewFact label="Canopy Tasks" value={String(row.sourceSummary?.taskCount ?? 0)} />
                </ReviewSection>

                <ReviewSection title="Current Source State">
                  <ReviewFact label="Canopy Status" value={row.sourceSummary?.statuses.length ? row.sourceSummary.statuses.join(", ") : "—"} />
                  <ReviewFact label="Source Assignees" value={row.sourceSummary?.assignees.length ? row.sourceSummary.assignees.join(", ") : "—"} />
                  <ReviewFact label="Task Due Dates" value={row.sourceSummary?.dueDates.length ? row.sourceSummary.dueDates.join(", ") : "—"} />
                </ReviewSection>

                <ReviewSection title="Amendment Audit Summary" className="md:col-span-2 xl:col-span-1">
                  <ReviewText label="Amendment Reason" value={row.opportunity.amendmentReasonSummary} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ReviewFact label="Recommendation" value={row.opportunity.recommendation || "Not assessed"} />
                    <ReviewFact label="Estimated Tax Impact" value={row.opportunity.estimatedTaxImpact == null ? "—" : formatMoney(Number(row.opportunity.estimatedTaxImpact))} />
                  </div>
                  <ReviewText label="Documents Received" value={row.opportunity.documentsReceivedSummary} />
                  <ReviewText label="Documents Needed" value={row.opportunity.documentsNeededSummary} />
                </ReviewSection>
              </div>
            </CardContent>
          </Card>;
        })}
      </section>
    )}

    <Dialog open={auditOpen} onOpenChange={open => { if (open) setAuditOpen(true); else closeAudit(); }}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Amendment Audit Pro</DialogTitle>
          <DialogDescription>{context.data ? `${context.data.client.clientName} · ${context.data.client.clientId}` : "Structured TaxAce amendment review"}</DialogDescription>
        </DialogHeader>

        {context.isLoading ? <LoadingPanel label="Loading Amendment Audit Pro source context" /> : context.error ? <ErrorPanel message={context.error.message} retry={() => context.refetch()} /> : context.data ? <div className="space-y-6">
          <section className="rounded-lg border bg-muted/20 p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold">Canopy Source Context</h3><p className="text-sm text-muted-foreground">Source facts are read-only and remain distinct from TaxAce workflow fields.</p></div>
              <StatusBadge status={context.data.opportunity.opportunityStatus} />
            </div>
            {context.data.source ? <>
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <SourceFact label="Client" value={context.data.source.workGroup.sourceClientName} />
                <SourceFact label="Parent Task" value={context.data.source.workGroup.parentTask} />
                <SourceFact label="Return Type" value={context.data.source.workGroup.returnType} />
                <SourceFact label="Tax Years" value={context.data.source.taxYears.join(", ")} />
                <SourceFact label="Source Batch" value={context.data.source.provenance?.batchId ?? "—"} />
                <SourceFact label="Filename" value={context.data.source.provenance?.filename ?? "—"} />
                <SourceFact label="Source Exported At" value={context.data.source.provenance?.sourceExportedAt ? formatDate(context.data.source.provenance.sourceExportedAt, true) : "—"} />
                <SourceFact label="Parser" value={context.data.source.provenance?.parserVersion ?? "—"} />
              </div>
              <div className="mt-4 overflow-x-auto rounded-md border bg-white"><table className="taxace-table"><thead><tr><th>Source Row</th><th>Task</th><th>Type</th><th>Tax Year</th><th>Canopy Status</th><th>Due Date</th><th>Assignee</th><th>Pinned</th></tr></thead><tbody>{context.data.source.sourceRows.map(row => <tr key={`${row.sourceRowNumber}-${row.task}`}><td>{row.sourceRowNumber}</td><td>{row.task}</td><td>{row.taskType}</td><td>{row.taxYear ?? "—"}</td><td>{row.canopyStatus}</td><td>{row.dueDate ?? "—"}</td><td>{row.assigneeRaw || "—"}</td><td>{row.pinned || "—"}</td></tr>)}</tbody></table></div>
            </> : <p className="text-sm text-muted-foreground">This legacy/manual Opportunity Review has no linked Canopy source work group.</p>}
          </section>

          <section className="space-y-4">
            <div><h3 className="font-semibold">Documentation Review</h3><p className="text-sm text-muted-foreground">Record what TaxAce has received and what is still required. This does not store Canopy documents.</p></div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Documents Received"><Textarea disabled={!canReview || auditReadyForCreation || auditMutating} value={audit.documentsReceivedSummary} onChange={event => setAudit({ ...audit, documentsReceivedSummary: event.target.value })} /></Field>
              <Field label="Documents Needed"><Textarea disabled={!canReview || auditReadyForCreation || auditMutating} value={audit.documentsNeededSummary} onChange={event => setAudit({ ...audit, documentsNeededSummary: event.target.value })} /></Field>
            </div>
          </section>

          <section className="space-y-4">
            <div><h3 className="font-semibold">Findings & Assessment</h3><p className="text-sm text-muted-foreground">Human-entered TaxAce findings only. Amendment Audit Pro does not generate recommendations.</p></div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Recommendation"><Select disabled={!canReview || auditReadyForCreation || auditMutating} value={audit.recommendation} onValueChange={recommendation => setAudit({ ...audit, recommendation })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not assessed</SelectItem>{recommendations.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Priority"><Select disabled={!canReview || auditReadyForCreation || auditMutating} value={audit.priority} onValueChange={priority => setAudit({ ...audit, priority })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["High", "Medium", "Low"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Estimated Tax Impact (USD, if known)"><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span><Input disabled={!canReview || auditReadyForCreation || auditMutating} type="text" inputMode="decimal" className="pl-7" value={audit.estimatedTaxImpact} onChange={event => { const normalized = sanitizeUsdInput(event.target.value); if (normalized !== null) setAudit({ ...audit, estimatedTaxImpact: normalized }); }} placeholder="0.00" /></div></Field>
              <div className="rounded-md border p-3 text-sm"><p className="font-medium">Audit timing</p><p className="mt-1 text-muted-foreground">Started: {context.data.auditDetail?.auditStartedAt ? formatDate(context.data.auditDetail.auditStartedAt, true) : "Not recorded"}</p><p className="text-muted-foreground">Completed: {context.data.auditDetail?.auditCompletedAt ? formatDate(context.data.auditDetail.auditCompletedAt, true) : "Not completed"}</p></div>
              <div className="md:col-span-2"><Field label="Amendment Reason"><Textarea disabled={!canReview || auditReadyForCreation || auditMutating} value={audit.amendmentReasonSummary} onChange={event => setAudit({ ...audit, amendmentReasonSummary: event.target.value })} /></Field></div>
              <div className="md:col-span-2"><Field label="Amendment Assessment"><Textarea disabled={!canReview || auditReadyForCreation || auditMutating} className="min-h-28" value={audit.amendmentAssessment} onChange={event => setAudit({ ...audit, amendmentAssessment: event.target.value })} /></Field></div>
              <Field label="Risk / Issue Notes"><Textarea disabled={!canReview || auditReadyForCreation || auditMutating} className="min-h-24" value={audit.riskIssueNotes} onChange={event => setAudit({ ...audit, riskIssueNotes: event.target.value })} /></Field>
              <Field label="Reviewer Notes"><Textarea disabled={!canReview || auditReadyForCreation || auditMutating} className="min-h-24" value={audit.reviewNotes} onChange={event => setAudit({ ...audit, reviewNotes: event.target.value })} /></Field>
            </div>
          </section>

          {auditReadyForCreation ? <section className="rounded-lg border border-teal-200 bg-teal-50 p-4"><div><p className="font-semibold text-teal-950">Audit decision: Ready to Create Amendment</p><p className="text-sm text-teal-800">Amendment Audit Pro is complete and locked. The next action is to create the controlled Amendment Record and confirm tax years, jurisdiction, and assignments.</p></div></section> : null}
        </div> : null}

        <DialogFooter className="mt-5 flex-col gap-3 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">{auditReadyForCreation ? <Button variant="outline" disabled><CheckCircle2 className="mr-2 h-4 w-4" />Audit Completed — Ready for Amendment Creation</Button> : canReview && selectedId ? <Button variant="outline" disabled={auditMutating || !auditDirty} onClick={() => save.mutate({ id: selectedId, ...auditPayload() })}><Save className="mr-2 h-4 w-4" />{save.isPending ? "Saving…" : "Save Draft"}</Button> : null}{!auditReadyForCreation && context.data ? auditDirty ? <span className="text-xs font-medium text-amber-700">Unsaved changes</span> : <span className="inline-flex items-center text-xs font-medium text-teal-700"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Saved</span> : null}</div>
          <div className="flex flex-wrap justify-end gap-2">{auditReadyForCreation ? canCreate && selectedId ? <Button onClick={() => { setAuditOpen(false); setCreateOpen(true); }}><Plus className="mr-2 h-4 w-4" />Create Amendment</Button> : null : canReview && selectedId ? outcomes.map(outcome => <Button key={outcome} variant={outcome === "Ready to Create Amendment" ? "default" : "outline"} disabled={auditMutating} onClick={() => complete.mutate({ id: selectedId, outcome, ...auditPayload() })}><CheckCircle2 className="mr-2 h-4 w-4" />{complete.isPending ? "Completing…" : outcome}</Button>) : null}</div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open && selectedId) setAuditOpen(true); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Create Amendment Record</DialogTitle><DialogDescription>Confirm TaxAce workflow fields. Canopy source facts initialize this form but do not automatically create the amendment.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amendment Type / Return Type"><Input value={amendmentType} onChange={event => setAmendmentType(event.target.value)} placeholder="1040-X" /></Field>
            <Field label="Tax Years"><Input value={years} onChange={event => setYears(event.target.value)} placeholder="2023, 2024" /></Field>
          </div>
          <Field label="Jurisdiction"><Select value={jurisdiction} onValueChange={value => setJurisdiction(value as typeof jurisdiction)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{jurisdictions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Assigned Preparer"><Select value={preparerId} onValueChange={setPreparerId}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{users.data?.filter(user => user.role !== "Viewer").map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email} · {user.role}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Current Owner"><Select value={ownerId} onValueChange={setOwnerId}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{users.data?.filter(user => user.role !== "Viewer").map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email} · {user.role}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="EA Reviewer (optional)"><Select value={eaReviewerId} onValueChange={setEaReviewerId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not assigned</SelectItem>{users.data?.filter(user => user.role !== "Viewer").map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email} · {user.role}</SelectItem>)}</SelectContent></Select></Field>
          </div>
          <div className="rounded-md border bg-muted/20 p-3 text-sm"><p><span className="font-medium">Amendment Reason:</span> {audit.amendmentReasonSummary || "Missing"}</p><p className="mt-1"><span className="font-medium">Assessment:</span> {audit.amendmentAssessment || "Missing"}</p><p className="mt-1"><span className="font-medium">Priority:</span> {audit.priority}</p></div>
        </div>
        <DialogFooter><Button variant="outline" disabled={create.isPending} onClick={() => { setCreateOpen(false); setAuditOpen(true); }}>Back to Audit</Button><Button disabled={create.isPending || !selectedId || !preparerId || !ownerId || !amendmentType.trim() || !audit.amendmentReasonSummary.trim() || !audit.amendmentAssessment.trim()} onClick={() => {
          if (!selectedId) return;
          const selectedYears = Array.from(new Set(years.split(",").map(value => Number(value.trim())).filter(Number.isInteger)));
          if (selectedYears.length === 0) { toast.error("Select at least one valid Tax Year."); return; }
          create.mutate({
            opportunityReviewId: selectedId,
            amendmentReason: audit.amendmentReasonSummary,
            amendmentAssessment: audit.amendmentAssessment,
            riskIssueNotes: audit.riskIssueNotes.trim() || null,
            amendmentType: amendmentType.trim(),
            taxYears: selectedYears.map(taxYear => ({ taxYear, jurisdiction })),
            assignedPreparerId: Number(preparerId),
            currentOwnerId: Number(ownerId),
            assignedEaReviewerId: eaReviewerId === "none" ? null : Number(eaReviewerId),
            priority: audit.priority as any,
          });
        }}>{create.isPending ? "Creating…" : "Confirm Controlled Creation"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function SourceFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>;
}

function ReviewSection({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return <section className={`min-w-0 space-y-3 rounded-lg border bg-white p-4 ${className}`}><h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h4>{children}</section>;
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium leading-5">{value}</p></div>;
}

function ReviewText({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 line-clamp-3 break-words text-sm leading-5" title={value ?? ""}>{value || "—"}</p></div>;
}
