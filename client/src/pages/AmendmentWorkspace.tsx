import { WorkspaceOperationalActions } from "@/components/WorkspaceOperationalActions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorPanel, formatDate, formatMoney, hasUiCapability, LoadingPanel, PageHeader, PriorityBadge, StatusBadge } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { runCrossWorkspaceRefreshers } from "@/lib/refreshPolicy";
import { ArrowLeft, Check, CheckCircle2, FilePlus2, GitMerge, GitPullRequestArrow, MessageSquarePlus, Pencil, UserRoundPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const workflow = ["Investigation","With Client","In Progress","Ready for EA Review","EA Review","Waiting for Payment","Ready for Signature","Ready to File","Filed","Waiting on IRS / FTB","Accepted","Closed"] as const;
const yearStatuses = ["Investigation","In Progress","Ready for EA Review","Waiting for Payment","Ready to File","Filed","Waiting on IRS / FTB","Accepted","Closed"] as const;
const filingStatuses = ["Not Filed","Ready to File","Filed","Waiting on Agency","Accepted","Rejected","Follow-up Required","Not Applicable"] as const;
type Action = "note" | "year" | "assign" | "split" | "merge" | null;
type AssessmentForm = { amendmentReason: string; assessmentSummary: string; documentsReceivedSummary: string; documentsNeededSummary: string; documentationStatus: string; federalTaxImpact: string; californiaTaxImpact: string; estimatedRefundBalanceDue: string; riskIfNotAmended: string; nextAction: string };

function assessmentFromData(data: any): AssessmentForm {
  return {
    amendmentReason: data.amendment.amendmentReason,
    assessmentSummary: data.amendment.assessmentSummary ?? "",
    documentsReceivedSummary: data.amendment.documentsReceivedSummary ?? "",
    documentsNeededSummary: data.amendment.documentsNeededSummary ?? "",
    documentationStatus: data.amendment.documentationStatus ?? "",
    federalTaxImpact: data.amendment.federalTaxImpact ?? "",
    californiaTaxImpact: data.amendment.californiaTaxImpact ?? "",
    estimatedRefundBalanceDue: data.amendment.estimatedRefundBalanceDue ?? "",
    riskIfNotAmended: data.amendment.riskIfNotAmended ?? "",
    nextAction: data.amendment.nextAction ?? "",
  };
}

export default function AmendmentWorkspace({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const workspace = trpc.amendments.workspace.useQuery({ id }, { enabled: Number.isInteger(id) });
  const source = trpc.operationalViews.workspaceSource.useQuery({ amendmentId: id }, { enabled: Number.isInteger(id) });
  const bootstrap = trpc.settings.bootstrap.useQuery();
  const users = trpc.settings.usersForAssignments.useQuery();
  const allAmendments = trpc.amendments.list.useQuery({ search: "", includeClosed: false });
  const utils = trpc.useUtils();
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear() - 1));
  const [jurisdiction, setJurisdiction] = useState("Federal & California");
  const [assignmentRole, setAssignmentRole] = useState("Current Owner");
  const [assigneeId, setAssigneeId] = useState("");
  const [splitYears, setSplitYears] = useState<number[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");
  const [assessmentEditing, setAssessmentEditing] = useState(false);
  const [assessment, setAssessment] = useState<AssessmentForm>({ amendmentReason: "", assessmentSummary: "", documentsReceivedSummary: "", documentsNeededSummary: "", documentationStatus: "", federalTaxImpact: "", californiaTaxImpact: "", estimatedRefundBalanceDue: "", riskIfNotAmended: "", nextAction: "" });

  const refresh = async () => runCrossWorkspaceRefreshers({
    workspace: () => Promise.all([utils.amendments.workspace.invalidate({ id }), utils.operationalViews.workspaceSource.invalidate({ amendmentId: id })]).then(() => undefined),
    tracker: () => Promise.all([utils.amendments.list.invalidate(), utils.operationalViews.tracker.invalidate()]).then(() => undefined),
    dashboard: () => utils.reporting.dashboard.invalidate(),
    activity: () => utils.activity.list.invalidate(),
  });

  const noteMutation = trpc.notes.add.useMutation({ onSuccess: async () => { setNote(""); setAction(null); toast.success("Internal Note added and saved"); await refresh(); }, onError: error => toast.error(error.message) });
  const addYear = trpc.taxYears.add.useMutation({ onSuccess: async () => { setAction(null); toast.success("Tax Year Record added and saved"); await refresh(); }, onError: error => toast.error(error.message) });
  const updateYear = trpc.taxYears.update.useMutation({ onError: error => toast.error(error.message) });
  const reassign = trpc.assignments.reassign.useMutation({ onSuccess: async () => { setAction(null); toast.success("Assignment updated and saved"); await refresh(); }, onError: error => toast.error(error.message) });
  const updateAssessment = trpc.amendments.updateAssessment.useMutation({ onSuccess: async () => { toast.success("Assessment changes saved"); setAssessmentEditing(false); await refresh(); }, onError: error => toast.error(error.message) });
  const split = trpc.amendments.split.useMutation({ onSuccess: async result => { toast.success("Amendment Record split successfully"); setAction(null); await refresh(); setLocation(`/amendments/${result.id}`); }, onError: error => toast.error(error.message) });
  const merge = trpc.amendments.merge.useMutation({ onSuccess: async () => { toast.success("Amendment Records merged successfully"); setAction(null); await refresh(); }, onError: error => toast.error(error.message) });

  const data = workspace.data;
  useEffect(() => {
    if (!data || assessmentEditing) return;
    setAssessment(assessmentFromData(data));
  }, [data, assessmentEditing]);

  const capabilities = bootstrap.data?.capabilities;
  const currentIndex = data ? workflow.indexOf(data.amendment.workflowStatus) : -1;
  const mergeOptions = useMemo(() => (allAmendments.data ?? []).filter(row => row.amendment.clientId === data?.amendment.clientId && row.amendment.id !== id), [allAmendments.data, data?.amendment.clientId, id]);
  if (workspace.isLoading) return <LoadingPanel label="Loading Amendment Workspace" />;
  if (workspace.error) return <ErrorPanel message={workspace.error.message} retry={() => workspace.refetch()} />;
  if (!data) return null;

  const canEdit = hasUiCapability(capabilities, "editTechnical");
  const canCoordinate = hasUiCapability(capabilities, "coordinateWorkflow");
  const canAssign = hasUiCapability(capabilities, "assign");
  const canSplitMerge = hasUiCapability(capabilities, "splitMerge");
  const canClose = hasUiCapability(capabilities, "close");
  const sourceData = source.data;
  const sourceSummary = sourceData?.sourceContexts[0];
  const pageDescription = sourceSummary
    ? `${data.client.clientId} · ${sourceSummary.parentTask} · ${sourceSummary.returnType} · Started ${formatDate(data.amendment.dateStarted)}`
    : `${data.client.clientId} · Started ${formatDate(data.amendment.dateStarted)}`;
  const federalImpact = Number(data.amendment.federalTaxImpact ?? 0);
  const californiaImpact = Number(data.amendment.californiaTaxImpact ?? 0);
  const hasDetailedTaxImpact = data.amendment.federalTaxImpact !== null || data.amendment.californiaTaxImpact !== null;
  const auditEstimatedTaxImpact = data.amendment.auditEstimatedTaxImpact === null ? null : Number(data.amendment.auditEstimatedTaxImpact);
  const estimatedTaxImpact = hasDetailedTaxImpact ? federalImpact + californiaImpact : auditEstimatedTaxImpact;
  const estimatedTaxImpactSource = hasDetailedTaxImpact ? "Federal + California assessment" : auditEstimatedTaxImpact !== null ? "Audit Pro estimate" : null;
  const assessmentBaseline = assessmentFromData(data);
  const assessmentDirty = JSON.stringify(assessment) !== JSON.stringify(assessmentBaseline);
  const dialogPending = noteMutation.isPending || addYear.isPending || reassign.isPending || split.isPending || merge.isPending;
  const dialogConfirmLabel = action === "note" ? (noteMutation.isPending ? "Adding Note…" : "Add Note") : action === "year" ? (addYear.isPending ? "Adding Tax Year…" : "Add Tax Year") : action === "assign" ? (reassign.isPending ? "Saving Assignment…" : "Save Assignment") : action === "split" ? (split.isPending ? "Splitting…" : "Split Amendment") : action === "merge" ? (merge.isPending ? "Merging…" : "Merge Amendment") : "Confirm";
  const dialogConfirmDisabled = dialogPending || (action === "note" && !note.trim()) || (action === "year" && !Number.isInteger(Number(taxYear))) || (action === "assign" && !assigneeId) || (action === "split" && splitYears.length === 0) || (action === "merge" && !mergeTarget);

  async function saveTaxYear(values: any) {
    await updateYear.mutateAsync(values);
    toast.success("Tax Year changes saved");
    await refresh();
  }

  function cancelAssessmentEdit() {
    setAssessment(assessmentBaseline);
    setAssessmentEditing(false);
  }

  return <div className="taxace-page max-w-[1700px]">
    <button onClick={() => setLocation("/amendments")} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to Amendment Tracker</button>
    <PageHeader eyebrow={data.amendment.amendmentRecordId} title={data.client.clientName} description={pageDescription} actions={<><PriorityBadge priority={data.amendment.priority} /><StatusBadge status={data.amendment.workflowStatus} /></>} />

    <Card className="taxace-card overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><div className="flex min-w-[1320px] items-center px-4 py-5">{workflow.map((status, index) => <div key={status} className="flex min-w-0 flex-1 items-center"><div className="flex min-w-0 flex-col items-center gap-2 text-center"><span className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${index < currentIndex ? "border-primary bg-primary text-white" : index === currentIndex ? "border-primary bg-primary/10 text-primary ring-4 ring-primary/10" : "bg-white text-muted-foreground"}`}>{index < currentIndex ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className={`max-w-[100px] text-[10px] leading-4 ${index === currentIndex ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{status}</span></div>{index < workflow.length - 1 ? <div className={`mb-6 h-px flex-1 ${index < currentIndex ? "bg-primary" : "bg-border"}`} /> : null}</div>)}</div></div></CardContent></Card>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card className="taxace-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Current Owner</p><p className="mt-2 font-medium">{sourceData?.currentOwnerName || "Unassigned"}</p></Card>
      <Card className="taxace-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Assigned Preparer</p><p className="mt-2 font-medium">{sourceData?.assignedPreparerName || "Unassigned"}</p></Card>
      <Card className="taxace-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Days in Status</p><p className="mt-2 font-medium">{Math.max(0, Math.floor((Date.now() - new Date(data.amendment.lastWorkflowStatusChange).getTime()) / 86400000))} days</p></Card>
      <Card className="taxace-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Estimated Tax Impact</p><p className="mt-2 font-medium">{estimatedTaxImpact === null ? "—" : formatMoney(estimatedTaxImpact)}</p>{estimatedTaxImpactSource ? <p className="mt-1 text-xs text-muted-foreground">{estimatedTaxImpactSource}</p> : null}</Card>
    </section>

    <Card className="taxace-card"><CardHeader className="pb-3"><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center gap-2">
      {canEdit ? <Button variant="outline" onClick={() => setAction("year")}><FilePlus2 className="mr-2 h-4 w-4" />Add Tax Year</Button> : null}
      {canAssign ? <Button variant="outline" onClick={() => setAction("assign")}><UserRoundPlus className="mr-2 h-4 w-4" />Assign</Button> : null}
      <WorkspaceOperationalActions amendmentId={id} workflowStatus={data.amendment.workflowStatus} lastClientRequestAt={data.amendment.lastClientRequestAt} paymentConfirmedAt={data.amendment.paymentConfirmedAt} signatureReceivedAt={data.amendment.signatureReceivedAt} canCoordinate={canCoordinate} canClose={canClose} onRefresh={refresh} />
      {canCoordinate ? <Button variant="outline" onClick={() => setAction("note")}><MessageSquarePlus className="mr-2 h-4 w-4" />Add Note</Button> : null}
      {canSplitMerge ? <Button variant="outline" onClick={() => setAction("split")}><GitPullRequestArrow className="mr-2 h-4 w-4" />Split Amendment</Button> : null}
      {canSplitMerge ? <Button variant="outline" onClick={() => setAction("merge")}><GitMerge className="mr-2 h-4 w-4" />Merge Amendment</Button> : null}
    </CardContent></Card>

    <Tabs defaultValue="assessment"><TabsList className="h-auto w-full justify-start overflow-x-auto bg-white p-1"><TabsTrigger value="assessment">Assessment</TabsTrigger><TabsTrigger value="source">Canopy Source</TabsTrigger><TabsTrigger value="tax-years">Tax Year Records</TabsTrigger><TabsTrigger value="activity">Activity Timeline</TabsTrigger><TabsTrigger value="notes">Internal Notes</TabsTrigger><TabsTrigger value="assignments">Assignments</TabsTrigger></TabsList>

      <TabsContent value="assessment" className="mt-4"><Card className="taxace-card"><CardHeader className="flex-row items-center justify-between gap-3"><div><CardTitle className="text-base">Amendment Assessment</CardTitle><p className="mt-1 text-xs text-muted-foreground">{assessmentEditing ? "Editing saved assessment data" : `Saved · Last updated ${formatDate(data.amendment.updatedAt, true)}`}</p></div>{canEdit && !assessmentEditing ? <Button size="sm" variant="outline" onClick={() => setAssessmentEditing(true)}><Pencil className="mr-2 h-4 w-4" />Edit Assessment</Button> : null}</CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2"><Label>Amendment Reason</Label><Textarea disabled={!canEdit || !assessmentEditing} value={assessment.amendmentReason} onChange={event => setAssessment({ ...assessment, amendmentReason: event.target.value })} /></div>
        <div className="md:col-span-2"><Label>Amendment Summary</Label><Textarea disabled={!canEdit || !assessmentEditing} value={assessment.assessmentSummary} onChange={event => setAssessment({ ...assessment, assessmentSummary: event.target.value })} /></div>
        <div><Label>Documents Received Summary</Label><Textarea disabled={!canEdit || !assessmentEditing} value={assessment.documentsReceivedSummary} onChange={event => setAssessment({ ...assessment, documentsReceivedSummary: event.target.value })} /></div>
        <div><Label>Documents Needed Summary</Label><Textarea disabled={!canEdit || !assessmentEditing} value={assessment.documentsNeededSummary} onChange={event => setAssessment({ ...assessment, documentsNeededSummary: event.target.value })} /></div>
        <div><Label>Documentation Status</Label><Input disabled value={assessment.documentationStatus || "Not assessed"} /><p className="mt-1 text-xs text-muted-foreground">Updated from the governed document checklist.</p></div>
        <div><Label>Estimated Refund / Balance Due</Label><Input disabled={!canEdit || !assessmentEditing} type="number" value={assessment.estimatedRefundBalanceDue} onChange={event => setAssessment({ ...assessment, estimatedRefundBalanceDue: event.target.value })} /></div>
        <div><Label>Federal Tax Impact</Label><Input disabled={!canEdit || !assessmentEditing} type="number" value={assessment.federalTaxImpact} onChange={event => setAssessment({ ...assessment, federalTaxImpact: event.target.value })} /></div>
        <div><Label>California Tax Impact</Label><Input disabled={!canEdit || !assessmentEditing} type="number" value={assessment.californiaTaxImpact} onChange={event => setAssessment({ ...assessment, californiaTaxImpact: event.target.value })} /></div>
        <div className="md:col-span-2"><Label>Risk if Not Amended</Label><Textarea disabled={!canEdit || !assessmentEditing} value={assessment.riskIfNotAmended} onChange={event => setAssessment({ ...assessment, riskIfNotAmended: event.target.value })} /></div>
        <div className="md:col-span-2"><Label>Next Action</Label><Input disabled={!canEdit || !assessmentEditing} value={assessment.nextAction} onChange={event => setAssessment({ ...assessment, nextAction: event.target.value })} /></div>
        {canEdit ? <div className="md:col-span-2 flex flex-wrap gap-2">{assessmentEditing ? <><Button variant="outline" disabled={updateAssessment.isPending} onClick={cancelAssessmentEdit}>Cancel Edit</Button><Button disabled={updateAssessment.isPending || !assessmentDirty || assessment.amendmentReason.trim().length < 3} onClick={() => updateAssessment.mutate({ id, amendmentReason: assessment.amendmentReason, assessmentSummary: assessment.assessmentSummary || null, documentsReceivedSummary: assessment.documentsReceivedSummary || null, documentsNeededSummary: assessment.documentsNeededSummary || null, documentationStatus: assessment.documentationStatus || null, federalTaxImpact: assessment.federalTaxImpact ? Number(assessment.federalTaxImpact) : null, californiaTaxImpact: assessment.californiaTaxImpact ? Number(assessment.californiaTaxImpact) : null, estimatedRefundBalanceDue: assessment.estimatedRefundBalanceDue ? Number(assessment.estimatedRefundBalanceDue) : null, riskIfNotAmended: assessment.riskIfNotAmended || null, nextAction: assessment.nextAction || null })}>{updateAssessment.isPending ? "Saving…" : "Save Changes"}</Button></> : <Button variant="outline" disabled><CheckCircle2 className="mr-2 h-4 w-4" />Assessment Saved</Button>}</div> : null}
      </CardContent></Card></TabsContent>

      <TabsContent value="source" className="mt-4">{source.isLoading ? <LoadingPanel label="Loading Canopy source context" /> : source.error ? <ErrorPanel message={source.error.message} retry={() => source.refetch()} /> : !sourceData?.sourceContexts.length ? <EmptyState title="No linked Canopy source context" description="This Amendment Record has no amendment_source_links provenance record." /> : <div className="space-y-4">{sourceData.sourceContexts.map(context => <Card key={context.workGroupId} className="taxace-card"><CardHeader><CardTitle className="text-base">{context.parentTask}</CardTitle><p className="text-xs text-muted-foreground">Canopy Source Work Group #{context.workGroupId} · {context.returnType}</p></CardHeader><CardContent className="space-y-4"><dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs font-semibold uppercase text-muted-foreground">Source Client</dt><dd className="mt-1 font-medium">{context.sourceClientName}</dd></div><div><dt className="text-xs font-semibold uppercase text-muted-foreground">Tax Years</dt><dd className="mt-1 font-medium">{context.taxYears.join(", ") || "—"}</dd></div><div><dt className="text-xs font-semibold uppercase text-muted-foreground">Canopy Status</dt><dd className="mt-1 font-medium">{context.statuses.join(", ") || "No status"}</dd></div><div><dt className="text-xs font-semibold uppercase text-muted-foreground">Source Assignees</dt><dd className="mt-1 font-medium">{context.assignees.join(", ") || "Unassigned"}</dd></div><div><dt className="text-xs font-semibold uppercase text-muted-foreground">Source Due Dates</dt><dd className="mt-1 font-medium">{context.dueDates.join(", ") || "None"}</dd></div><div><dt className="text-xs font-semibold uppercase text-muted-foreground">Logical Tasks</dt><dd className="mt-1 font-medium">{context.taskCount}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-muted-foreground">Last Source Export</dt><dd className="mt-1 font-medium">{formatDate(context.lastSeenSourceExportedAt, true)}</dd></div></dl><div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">Canopy Status, source due dates, and source assignees are provenance only. They do not replace TaxAce Workflow Status, internal due dates, Assigned Preparer, EA Reviewer, or Current Owner.</div><div className="taxace-table-wrap"><table className="taxace-table"><thead><tr><th>Task</th><th>Task Type</th><th>Tax Year</th><th>Return Type</th><th>Canopy Status</th><th>Due Date</th><th>Source Assignee</th><th>Pinned</th></tr></thead><tbody>{sourceData.tasks.filter(task => task.workGroupId === context.workGroupId).map(task => <tr key={task.id}><td className="font-medium">{task.task}</td><td>{task.taskType}</td><td>{task.taxYear}</td><td>{task.returnType}</td><td>{task.canopyStatus || "No status"}</td><td>{task.dueDate || "—"}</td><td>{task.assignees?.join(", ") || "—"}</td><td>{task.pinned ? "Yes" : "No"}</td></tr>)}</tbody></table></div></CardContent></Card>)}</div>}</TabsContent>

      <TabsContent value="tax-years" className="mt-4"><div className="space-y-4">{auditEstimatedTaxImpact !== null && data.taxYears.length > 1 ? <Card className="taxace-card border-amber-200 bg-amber-50"><CardContent className="p-4"><p className="text-sm font-semibold text-amber-950">Amendment-level Audit Pro estimate: {formatMoney(auditEstimatedTaxImpact)}</p><p className="mt-1 text-xs text-amber-800">This estimate applies to the amendment as a whole and has not been allocated across Tax Years {data.taxYears.map(year => year.taxYear).join(", ")}. Enter a separate Estimated Impact in each Tax Year Record when the year-by-year allocation is known.</p></CardContent></Card> : null}<div className="grid gap-4 lg:grid-cols-2">{data.taxYears.map(year => {
        const latestActivity = data.activities.find(row => row.activity.entityType === "Tax Year Record" && row.activity.entityId === year.id);
        return <TaxYearCard key={year.id} year={year} editable={canEdit || hasUiCapability(capabilities,"performEaReview")} assignedUserName={sourceData?.assignedPreparerName || "Unassigned"} lastActivity={latestActivity ? `${latestActivity.activity.action} · ${formatDate(latestActivity.activity.createdAt, true)}` : `Created ${formatDate(year.createdAt, true)}`} auditEstimate={auditEstimatedTaxImpact} singleTaxYear={data.taxYears.length === 1} onSave={saveTaxYear} selected={splitYears.includes(year.id)} onSelect={checked => setSplitYears(current => checked ? [...current, year.id] : current.filter(item => item !== year.id))} />;
      })}</div></div></TabsContent>

      <TabsContent value="activity" className="mt-4"><Card className="taxace-card"><CardContent className="divide-y p-0">{data.activities.length ? data.activities.map(row => <div key={row.activity.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]"><div><p className="text-sm font-semibold">{row.activity.action}</p><p className="text-xs text-muted-foreground">{row.actorName || "System"} · {row.activity.entityType}</p>{row.activity.note ? <p className="mt-2 text-sm text-muted-foreground">{row.activity.note}</p> : null}</div><time className="text-xs text-muted-foreground">{formatDate(row.activity.createdAt, true)}</time></div>) : <div className="p-5"><EmptyState title="No Activity History" description="Material changes are appended automatically." /></div>}</CardContent></Card></TabsContent>
      <TabsContent value="notes" className="mt-4"><Card className="taxace-card"><CardContent className="divide-y p-0">{data.notes.length ? data.notes.map(row => <div key={row.note.id} className="p-4"><p className="whitespace-pre-wrap text-sm">{row.note.body}</p><p className="mt-2 text-xs text-muted-foreground">{row.authorName || "Unknown user"} · {formatDate(row.note.createdAt, true)}</p></div>) : <div className="p-5"><EmptyState title="No Internal Notes" description="Authorized users can add timestamped operational notes." /></div>}</CardContent></Card></TabsContent>
      <TabsContent value="assignments" className="mt-4"><div className="space-y-4"><section className="grid gap-3 md:grid-cols-3"><Card className="taxace-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Assigned Preparer</p><p className="mt-2 font-medium">{sourceData?.assignedPreparerName || "Unassigned"}</p></Card><Card className="taxace-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">EA Reviewer</p><p className="mt-2 font-medium">{sourceData?.assignedEaReviewerName || "Unassigned"}</p></Card><Card className="taxace-card p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Current Owner</p><p className="mt-2 font-medium">{sourceData?.currentOwnerName || "Unassigned"}</p></Card></section><div className="taxace-table-wrap"><table className="taxace-table"><thead><tr><th>Assignment</th><th>Assignee</th><th>Assigned Date</th><th>Current</th></tr></thead><tbody>{data.assignments.map(row => <tr key={row.assignment.id}><td>{row.assignment.assignmentRole}</td><td>{row.assigneeName || `User #${row.assignment.assigneeId}`}</td><td>{formatDate(row.assignment.assignmentDate, true)}</td><td>{row.assignment.current ? "Current" : "Historical"}</td></tr>)}</tbody></table></div></div></TabsContent>
    </Tabs>

    <Dialog open={Boolean(action)} onOpenChange={open => !open && !dialogPending && setAction(null)}><DialogContent><DialogHeader><DialogTitle>{action === "note" ? "Add Internal Note" : action === "year" ? "Add Tax Year Record" : action === "assign" ? "Update Assignment" : action === "split" ? "Split Amendment" : action === "merge" ? "Merge Amendment" : "Confirm Action"}</DialogTitle><DialogDescription>{action === "split" ? "Selected Tax Year Records move transactionally to a new Amendment Record; at least one year must remain." : action === "merge" ? "The source record is closed and linked to the target while Tax Year Records, notes, assignments, source links, and history remain preserved." : "TaxAce will enforce authorization and business prerequisites on the server."}</DialogDescription></DialogHeader>
      {action === "note" ? <Textarea disabled={dialogPending} value={note} onChange={event => setNote(event.target.value)} placeholder="Internal operational note" /> : null}
      {action === "year" ? <div className="grid gap-4"><div><Label>Tax Year</Label><Input disabled={dialogPending} value={taxYear} onChange={event => setTaxYear(event.target.value)} /></div><div><Label>Jurisdiction</Label><Select disabled={dialogPending} value={jurisdiction} onValueChange={setJurisdiction}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Federal","California","Federal & California","Other State"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div></div> : null}
      {action === "assign" ? <div className="grid gap-4"><div><Label>Assignment Role</Label><Select disabled={dialogPending} value={assignmentRole} onValueChange={setAssignmentRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Assigned Preparer","EA Reviewer","Current Owner"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div><div><Label>Assignee</Label><Select disabled={dialogPending} value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger><SelectValue placeholder="Select active user" /></SelectTrigger><SelectContent>{users.data?.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name || user.email} · {user.role}</SelectItem>)}</SelectContent></Select></div></div> : null}
      {action === "split" ? <div className="space-y-2">{data.taxYears.map(year => <label key={year.id} className="flex items-center gap-3 rounded-md border p-3"><input disabled={dialogPending} type="checkbox" checked={splitYears.includes(year.id)} onChange={event => setSplitYears(current => event.target.checked ? [...current, year.id] : current.filter(item => item !== year.id))} />Tax Year {year.taxYear}</label>)}<p className="text-xs text-muted-foreground">The new record uses the current Assigned Preparer and Current Owner. Canopy source links are preserved transactionally.</p></div> : null}
      {action === "merge" ? <Select disabled={dialogPending} value={mergeTarget} onValueChange={setMergeTarget}><SelectTrigger><SelectValue placeholder="Select target Amendment Record" /></SelectTrigger><SelectContent>{mergeOptions.map(row => <SelectItem key={row.amendment.id} value={String(row.amendment.id)}>{row.amendment.amendmentRecordId}</SelectItem>)}</SelectContent></Select> : null}
      <DialogFooter><Button variant="outline" disabled={dialogPending} onClick={() => setAction(null)}>Cancel</Button><Button disabled={dialogConfirmDisabled} onClick={() => { if (action === "note") noteMutation.mutate({ amendmentId: id, body: note }); if (action === "year") addYear.mutate({ amendmentId: id, taxYear: Number(taxYear), jurisdiction: jurisdiction as any }); if (action === "assign") reassign.mutate({ amendmentId: id, role: assignmentRole as any, assigneeId: Number(assigneeId) }); if (action === "split") split.mutate({ sourceAmendmentId: id, taxYearRecordIds: splitYears, assignedPreparerId: data.amendment.assignedPreparerId, currentOwnerId: data.amendment.currentOwnerId }); if (action === "merge") merge.mutate({ sourceAmendmentId: id, targetAmendmentId: Number(mergeTarget) }); }}>{dialogConfirmLabel}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}

function dateInputValue(value: unknown): string {
  if (!value) return "";
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function TaxYearCard({ year, editable, assignedUserName, lastActivity, auditEstimate, singleTaxYear, onSave, selected, onSelect }: { year: any; editable: boolean; assignedUserName: string; lastActivity: string; auditEstimate: number | null; singleTaxYear: boolean; onSave: (values: any) => Promise<void>; selected: boolean; onSelect: (checked: boolean) => void }) {
  const amendmentResults = ["Additional Refund","Reduced Balance Due","Increased Refund Offset","Balance Due","No Financial Change","Informational Amendment"] as const;
  const [status, setStatus] = useState(year.taxYearStatus);
  const [filingMethod, setFilingMethod] = useState(year.filingMethod ?? "none");
  const [jurisdictionValue, setJurisdictionValue] = useState(year.jurisdiction);
  const [federalStatus, setFederalStatus] = useState(year.federalStatus ?? "");
  const [stateStatus, setStateStatus] = useState(year.stateStatus ?? "");
  const [dateFiled, setDateFiled] = useState(dateInputValue(year.dateFiled));
  const [dateAccepted, setDateAccepted] = useState(dateInputValue(year.dateAccepted));
  const [amendmentResult, setAmendmentResult] = useState(year.amendmentResult ?? "none");
  const [estimatedImpact, setEstimatedImpact] = useState(year.estimatedImpact == null ? "" : String(year.estimatedImpact));
  const [finalImpact, setFinalImpact] = useState(year.finalImpact == null ? "" : String(year.finalImpact));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const syncFromYear = () => {
    setStatus(year.taxYearStatus);
    setFilingMethod(year.filingMethod ?? "none");
    setJurisdictionValue(year.jurisdiction);
    setFederalStatus(year.federalStatus ?? "");
    setStateStatus(year.stateStatus ?? "");
    setDateFiled(dateInputValue(year.dateFiled));
    setDateAccepted(dateInputValue(year.dateAccepted));
    setAmendmentResult(year.amendmentResult ?? "none");
    setEstimatedImpact(year.estimatedImpact == null ? "" : String(year.estimatedImpact));
    setFinalImpact(year.finalImpact == null ? "" : String(year.finalImpact));
  };

  useEffect(() => {
    if (editing) return;
    syncFromYear();
  }, [year.taxYearStatus, year.filingMethod, year.jurisdiction, year.federalStatus, year.stateStatus, year.dateFiled, year.dateAccepted, year.amendmentResult, year.estimatedImpact, year.finalImpact, editing]);

  const baseline = {
    status: year.taxYearStatus,
    filingMethod: year.filingMethod ?? "none",
    jurisdictionValue: year.jurisdiction,
    federalStatus: year.federalStatus ?? "",
    stateStatus: year.stateStatus ?? "",
    dateFiled: dateInputValue(year.dateFiled),
    dateAccepted: dateInputValue(year.dateAccepted),
    amendmentResult: year.amendmentResult ?? "none",
    estimatedImpact: year.estimatedImpact == null ? "" : String(year.estimatedImpact),
    finalImpact: year.finalImpact == null ? "" : String(year.finalImpact),
  };
  const current = { status, filingMethod, jurisdictionValue, federalStatus, stateStatus, dateFiled, dateAccepted, amendmentResult, estimatedImpact, finalImpact };
  const dirty = JSON.stringify(current) !== JSON.stringify(baseline);
  const invalidEstimated = estimatedImpact.trim() !== "" && !Number.isFinite(Number(estimatedImpact));
  const invalidFinal = finalImpact.trim() !== "" && !Number.isFinite(Number(finalImpact));
  const invalidDates = Boolean(dateFiled && dateAccepted && dateAccepted < dateFiled);
  const legacyFederalStatus = federalStatus && !filingStatuses.includes(federalStatus as (typeof filingStatuses)[number]) ? federalStatus : null;
  const legacyStateStatus = stateStatus && !filingStatuses.includes(stateStatus as (typeof filingStatuses)[number]) ? stateStatus : null;
  const inheritedAuditEstimate = year.estimatedImpact == null && singleTaxYear ? auditEstimate : null;

  const cancelEdit = () => {
    syncFromYear();
    setEditing(false);
  };
  const changeJurisdiction = (value: string) => {
    setJurisdictionValue(value);
    if (value === "Federal") {
      setStateStatus("Not Applicable");
      if (federalStatus === "Not Applicable") setFederalStatus("");
      return;
    }
    if (value === "California" || value === "Other State") {
      setFederalStatus("Not Applicable");
      if (stateStatus === "Not Applicable") setStateStatus("");
      return;
    }
    if (value === "Federal & California") {
      if (federalStatus === "Not Applicable") setFederalStatus("");
      if (stateStatus === "Not Applicable") setStateStatus("");
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        id: year.id,
        taxYearStatus: status,
        filingMethod: filingMethod === "none" ? null : filingMethod,
        jurisdiction: jurisdictionValue,
        federalStatus: federalStatus.trim() || null,
        stateStatus: stateStatus.trim() || null,
        dateFiled: dateFiled ? new Date(`${dateFiled}T00:00:00.000Z`).toISOString() : null,
        dateAccepted: dateAccepted ? new Date(`${dateAccepted}T00:00:00.000Z`).toISOString() : null,
        amendmentResult: amendmentResult === "none" ? null : amendmentResult,
        estimatedImpact: estimatedImpact.trim() ? Number(estimatedImpact) : null,
        finalImpact: finalImpact.trim() ? Number(finalImpact) : null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return <Card className="taxace-card"><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="text-lg">Tax Year {year.taxYear}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{year.jurisdiction}</p><p className="mt-1 text-xs text-muted-foreground">{editing ? "Editing saved Tax Year Record" : "Saved Tax Year Record"}</p></div><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} />Select for split</label></CardHeader><CardContent className="space-y-4">
    <StatusBadge status={status} />
    {editing ? <div className="grid gap-4 sm:grid-cols-2">
      <div><Label>Tax Year Status</Label><Select value={status} onValueChange={setStatus} disabled={!editable || saving}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{yearStatuses.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Filing Method</Label><Select value={filingMethod} onValueChange={setFilingMethod} disabled={!editable || saving}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem><SelectItem value="Electronic Filing">Electronic Filing</SelectItem><SelectItem value="Paper Filing">Paper Filing</SelectItem></SelectContent></Select></div>
      <div><Label>Jurisdiction</Label><Select value={jurisdictionValue} onValueChange={changeJurisdiction} disabled={!editable || saving}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["Federal","California","Federal & California","Other State"].map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Amendment Result</Label><Select value={amendmentResult} onValueChange={setAmendmentResult} disabled={!editable || saving}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{amendmentResults.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Federal Status</Label><Select value={federalStatus || "none"} onValueChange={value => setFederalStatus(value === "none" ? "" : value)} disabled={!editable || saving || jurisdictionValue === "California" || jurisdictionValue === "Other State"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{legacyFederalStatus ? <SelectItem value={legacyFederalStatus}>Legacy: {legacyFederalStatus}</SelectItem> : null}{filingStatuses.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>State Status</Label><Select value={stateStatus || "none"} onValueChange={value => setStateStatus(value === "none" ? "" : value)} disabled={!editable || saving || jurisdictionValue === "Federal"}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not selected</SelectItem>{legacyStateStatus ? <SelectItem value={legacyStateStatus}>Legacy: {legacyStateStatus}</SelectItem> : null}{filingStatuses.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Date Filed</Label><Input disabled={!editable || saving} type="date" value={dateFiled} onChange={event => setDateFiled(event.target.value)} /></div>
      <div><Label>Date Accepted</Label><Input disabled={!editable || saving} type="date" value={dateAccepted} onChange={event => setDateAccepted(event.target.value)} /></div>
      <div><Label>Estimated Impact</Label><Input disabled={!editable || saving} inputMode="decimal" value={estimatedImpact} onChange={event => setEstimatedImpact(event.target.value)} placeholder="0.00" />{year.estimatedImpact == null && auditEstimate !== null ? <p className="mt-1 text-xs text-muted-foreground">{singleTaxYear ? `Audit Pro estimate: ${formatMoney(auditEstimate)}. This is shown as context until a Tax Year estimate is saved.` : `Amendment-level Audit Pro estimate: ${formatMoney(auditEstimate)}. It is not automatically allocated to this Tax Year.`}</p> : null}</div>
      <div><Label>Final Impact</Label><Input disabled={!editable || saving} inputMode="decimal" value={finalImpact} onChange={event => setFinalImpact(event.target.value)} placeholder="0.00" /></div>
      <div className="sm:col-span-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Assigned User:</span> {assignedUserName}. Assignment is managed from the workspace <span className="font-semibold text-foreground">Assign</span> action so ownership stays consistent across the Amendment Record and its Tax Year Records.</div>
      {invalidDates ? <p className="sm:col-span-2 text-xs font-medium text-red-700">Date Accepted cannot be earlier than Date Filed.</p> : null}
      {invalidEstimated || invalidFinal ? <p className="sm:col-span-2 text-xs font-medium text-red-700">Estimated Impact and Final Impact must be valid numbers.</p> : null}
    </div> : <dl className="grid grid-cols-2 gap-3 text-xs">
      <div><dt className="text-muted-foreground">Tax Year Status</dt><dd className="mt-1 font-medium">{year.taxYearStatus}</dd></div><div><dt className="text-muted-foreground">Filing Method</dt><dd className="mt-1 font-medium">{year.filingMethod || "Not selected"}</dd></div>
      <div><dt className="text-muted-foreground">Jurisdiction</dt><dd className="mt-1 font-medium">{year.jurisdiction}</dd></div><div><dt className="text-muted-foreground">Assigned User</dt><dd className="mt-1 font-medium">{assignedUserName}</dd></div>
      <div><dt className="text-muted-foreground">Federal Status</dt><dd className="mt-1 font-medium">{year.federalStatus || "—"}</dd></div><div><dt className="text-muted-foreground">State Status</dt><dd className="mt-1 font-medium">{year.stateStatus || "—"}</dd></div>
      <div><dt className="text-muted-foreground">Date Filed</dt><dd className="mt-1 font-medium">{formatDate(year.dateFiled)}</dd></div><div><dt className="text-muted-foreground">Date Accepted</dt><dd className="mt-1 font-medium">{formatDate(year.dateAccepted)}</dd></div>
      <div><dt className="text-muted-foreground">Amendment Result</dt><dd className="mt-1 font-medium">{year.amendmentResult || "—"}</dd></div><div><dt className="text-muted-foreground">Estimated Impact</dt><dd className="mt-1 font-medium">{year.estimatedImpact != null ? <>{formatMoney(Number(year.estimatedImpact))}<span className="block text-[10px] font-normal text-muted-foreground">Tax Year estimate</span></> : inheritedAuditEstimate !== null ? <>{formatMoney(inheritedAuditEstimate)}<span className="block text-[10px] font-normal text-muted-foreground">Audit Pro estimate · amendment-level</span></> : "—"}</dd></div>
      <div><dt className="text-muted-foreground">Final Impact</dt><dd className="mt-1 font-medium">{year.finalImpact !== null ? formatMoney(Number(year.finalImpact)) : "—"}</dd></div><div><dt className="text-muted-foreground">Last Activity</dt><dd className="mt-1 font-medium">{lastActivity}</dd></div>
    </dl>}
    {editable ? <div className="flex flex-wrap gap-2">{editing ? <><Button size="sm" variant="outline" disabled={saving} onClick={cancelEdit}>Cancel Edit</Button><Button size="sm" disabled={saving || !dirty || invalidEstimated || invalidFinal || invalidDates} onClick={save}>{saving ? "Saving…" : "Save Changes"}</Button></> : <><Button size="sm" variant="outline" disabled><CheckCircle2 className="mr-2 h-4 w-4" />Tax Year Saved</Button><Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-2 h-4 w-4" />Edit Tax Year</Button></>}</div> : null}
  </CardContent></Card>;
}
