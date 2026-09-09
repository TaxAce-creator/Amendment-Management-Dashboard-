import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorPanel, hasUiCapability, LoadingPanel, PageHeader, PriorityBadge, StatusBadge } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { WORKFLOW_TRANSITIONS } from "@shared/taxace";
import { FileWarning, GripVertical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const statuses = ["Investigation","With Client","In Progress","Ready for EA Review","EA Review","Waiting for Payment","Ready for Signature","Ready to File","Filed","Waiting on IRS / FTB","Accepted"] as const;
type PipelineStatus = typeof statuses[number];
type Move = { id: number; recordId: string; from: PipelineStatus; to: PipelineStatus };
type DraggedRecord = Omit<Move, "to">;

export default function Pipeline() {
  const list = trpc.operationalViews.tracker.useQuery({ search: "", includeClosed: false });
  const bootstrap = trpc.settings.bootstrap.useQuery();
  const utils = trpc.useUtils();
  const [move, setMove] = useState<Move | null>(null);
  const [dragging, setDragging] = useState<DraggedRecord | null>(null);
  const [, setLocation] = useLocation();
  const canCoordinate = hasUiCapability(bootstrap.data?.capabilities, "coordinateWorkflow");
  const mutation = trpc.amendments.updateWorkflow.useMutation({
    onSuccess: () => {
      toast.success("Workflow Status updated");
      setMove(null);
      setDragging(null);
      utils.operationalViews.tracker.invalidate();
      utils.amendments.list.invalidate();
      utils.reporting.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  if (list.isLoading) return <LoadingPanel label="Loading workflow pipeline" />;
  if (list.error) return <ErrorPanel message={list.error.message} retry={() => list.refetch()} />;
  const rows = list.data ?? [];
  return <div className="taxace-page max-w-none">
    <PageHeader eyebrow="Pipeline" title="Amendment workflow" description="TaxAce Workflow Status drives these columns. During drag, only approved workflow targets are enabled; business prerequisites are still validated on the server before a move is saved." />
    {rows.length === 0 ? <EmptyState title="No active pipeline records" description="Create an Amendment Record from an eligible Opportunity Review to begin the workflow." /> : <div className="overflow-x-auto pb-4"><div className="flex min-w-max gap-3">{statuses.map(status => {
      const column = rows.filter(row => row.amendment.workflowStatus === status);
      const structurallyValidTarget = !dragging || (WORKFLOW_TRANSITIONS[dragging.from] as readonly string[]).includes(status);
      const sameColumn = dragging?.from === status;
      const dropEnabled = Boolean(canCoordinate && dragging && structurallyValidTarget && !sameColumn);
      return <section key={status} className={`w-[320px] shrink-0 rounded-lg border bg-muted/30 transition ${dragging ? dropEnabled ? "border-primary bg-primary/5 ring-2 ring-primary/10" : "opacity-60" : ""}`} onDragOver={event => { if (dropEnabled) event.preventDefault(); }} onDrop={event => {
        if (!dropEnabled || !dragging) return;
        event.preventDefault();
        setMove({ ...dragging, to: status });
        setDragging(null);
      }}>
        <div className="flex items-center justify-between border-b bg-white px-3 py-3"><div><StatusBadge status={status} />{dragging ? <p className="mt-1 text-[10px] text-muted-foreground">{dropEnabled ? "Valid move target" : sameColumn ? "Current status" : "Not an approved next/return status"}</p> : null}</div><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{column.length}</span></div>
        <div className="space-y-3 p-3">{column.map(row => {
          const source = row.sourceContexts[0];
          return <Card key={row.amendment.id} draggable={canCoordinate} onDragStart={event => {
            if (!canCoordinate) return;
            const payload = { id: row.amendment.id, recordId: row.amendment.amendmentRecordId, from: status };
            setDragging(payload);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/json", JSON.stringify(payload));
          }} onDragEnd={() => setDragging(null)} onClick={() => setLocation(`/amendments/${row.amendment.id}`)} className={`${canCoordinate ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} p-3 shadow-sm hover:border-primary/40`}>
            <div className="flex items-start gap-2">{canCoordinate ? <GripVertical className="mt-0.5 h-4 w-4 text-muted-foreground" /> : null}<div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{row.client.clientName}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{row.amendment.amendmentRecordId}</p></div><PriorityBadge priority={row.amendment.priority} /></div>
            <div className="mt-3 flex flex-wrap gap-1">{row.taxYears.map(year => <span key={year.id} className="rounded border bg-muted px-2 py-0.5 text-[11px]">{year.taxYear}</span>)}</div>
            {source ? <div className="mt-3 rounded-md border bg-muted/30 px-2.5 py-2 text-[11px]"><p className="font-medium">{source.parentTask}</p><p className="mt-0.5 text-muted-foreground">Canopy source · {source.returnType}</p></div> : null}
            {row.amendment.documentsNeededSummary ? <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900"><FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2">{row.amendment.documentsNeededSummary}</span></div> : null}
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs"><div><dt className="text-muted-foreground">Days in status</dt><dd className="mt-0.5 font-medium">{row.ageDays}</dd></div><div><dt className="text-muted-foreground">Current owner</dt><dd className="mt-0.5 truncate font-medium">{row.currentOwnerName || "Unassigned"}</dd></div><div><dt className="text-muted-foreground">Preparer</dt><dd className="mt-0.5 truncate font-medium">{row.assignedPreparerName || "Unassigned"}</dd></div><div><dt className="text-muted-foreground">EA reviewer</dt><dd className="mt-0.5 truncate font-medium">{row.assignedEaReviewerName || "Unassigned"}</dd></div></dl>
            <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.amendment.nextAction || "No next action recorded."}</p>
          </Card>;
        })}{column.length === 0 ? <div className="rounded-lg border border-dashed bg-white p-4 text-center text-xs text-muted-foreground">No records</div> : null}</div>
      </section>;
    })}</div></div>}
    <Dialog open={Boolean(move)} onOpenChange={open => !open && setMove(null)}><DialogContent><DialogHeader><DialogTitle>Confirm workflow move</DialogTitle><DialogDescription>{move?.recordId} will move from {move?.from} to {move?.to}. This is an approved structural transition; TaxAce will still reject missing payment, signature, Tax Year closure, review, or authorization prerequisites.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={() => setMove(null)}>Cancel</Button><Button disabled={mutation.isPending || !canCoordinate} onClick={() => move && mutation.mutate({ id: move.id, toStatus: move.to, note: "Pipeline drag-and-drop move" })}>{mutation.isPending ? "Validating…" : "Confirm Move"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}