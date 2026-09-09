import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, ChevronRight, ClipboardCheck, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const workflowTransitions: Record<string, readonly string[]> = {
  Investigation: ["With Client", "In Progress"],
  "With Client": ["Investigation", "In Progress"],
  "In Progress": ["With Client", "Ready for EA Review"],
  "Ready for EA Review": ["In Progress", "EA Review"],
  "EA Review": ["Ready for EA Review", "In Progress", "Waiting for Payment"],
  "Waiting for Payment": ["EA Review", "Ready for Signature"],
  "Ready for Signature": ["Waiting for Payment", "Ready to File"],
  "Ready to File": ["Ready for Signature", "Filed"],
  Filed: ["Ready to File", "Waiting on IRS / FTB"],
  "Waiting on IRS / FTB": ["Filed", "Accepted"],
  Accepted: ["Waiting on IRS / FTB", "Closed"],
  Closed: [],
};

const transitionLabels: Record<string, Record<string, string>> = {
  Investigation: { "With Client": "Await Documents in Canopy", "In Progress": "Start Amendment Work" },
  "With Client": { Investigation: "Return to Investigation", "In Progress": "Resume Amendment Work" },
  "In Progress": { "With Client": "Await Additional Documents in Canopy", "Ready for EA Review": "Submit for EA Review" },
  "Ready for EA Review": { "In Progress": "Return to In Progress", "EA Review": "Start EA Review" },
  "EA Review": { "Ready for EA Review": "Return to Ready for EA Review", "In Progress": "Return for Correction", "Waiting for Payment": "Approve Review · Waiting for Payment" },
  "Waiting for Payment": { "EA Review": "Return to EA Review", "Ready for Signature": "Move to Ready for Signature" },
  "Ready for Signature": { "Waiting for Payment": "Return to Waiting for Payment", "Ready to File": "Move to Ready to File" },
  "Ready to File": { "Ready for Signature": "Return to Ready for Signature", Filed: "Mark Filed" },
  Filed: { "Ready to File": "Return to Ready to File", "Waiting on IRS / FTB": "Move to Agency Processing" },
  "Waiting on IRS / FTB": { Filed: "Return to Filed", Accepted: "Mark Accepted" },
  Accepted: { "Waiting on IRS / FTB": "Return to Waiting on IRS / FTB", Closed: "Close Amendment" },
};

type Props = {
  amendmentId: number;
  workflowStatus: string;
  lastClientRequestAt: Date | string | null;
  paymentConfirmedAt: Date | string | null;
  signatureReceivedAt: Date | string | null;
  canCoordinate: boolean;
  canClose: boolean;
  onRefresh: () => Promise<void>;
};

export function WorkspaceOperationalActions({ amendmentId, workflowStatus, lastClientRequestAt, paymentConfirmedAt, signatureReceivedAt, canCoordinate, canClose, onRefresh }: Props) {
  const documents = trpc.documents.workspace.useQuery({ amendmentId }, { enabled: canCoordinate });
  const workflowMutation = trpc.amendments.updateWorkflow.useMutation({
    onSuccess: async (_result, variables) => {
      toast.success(`Workflow moved to ${variables.toStatus}`);
      setWorkflowOpen(false);
      setWorkflowNote("");
      await onRefresh();
    },
    onError: error => toast.error(error.message),
  });
  const requestDocuments = trpc.documents.request.useMutation({
    onSuccess: async result => {
      toast.success(result.movedToWithClient
        ? `Required documents saved · workflow moved to With Client`
        : `Required documents saved · ${result.documents.length} item${result.documents.length === 1 ? "" : "s"}`);
      setDocumentsOpen(false);
      setSelectedDocumentIds([]);
      setDocumentNote("");
      await Promise.all([documents.refetch(), onRefresh()]);
    },
    onError: error => toast.error(error.message),
  });
  const updateDocument = trpc.documents.updateStatus.useMutation({
    onSuccess: async result => {
      toast.success(result.allResolved ? "All tracked documents verified in Canopy" : "Document checklist updated");
      await Promise.all([documents.refetch(), onRefresh()]);
    },
    onError: error => toast.error(error.message),
  });
  const milestone = trpc.workspaceActions.recordMilestone.useMutation({
    onSuccess: async (_result, variables) => {
      const message = variables.milestone === "payment" ? "Payment confirmed" : "Signature received recorded";
      toast.success(message);
      await onRefresh();
    },
    onError: error => toast.error(error.message),
  });

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowTarget, setWorkflowTarget] = useState("");
  const [workflowNote, setWorkflowNote] = useState("");
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>([]);
  const [documentNote, setDocumentNote] = useState("");
  const validTargets = workflowTransitions[workflowStatus] ?? [];
  const actionableTargets = validTargets.filter(target => target !== "Closed" || canClose);
  const requestedItems = documents.data?.items.filter(row => row.checklist.status === "Requested") ?? [];
  const unresolvedItems = documents.data?.items.filter(row => ["Needed", "Requested"].includes(row.checklist.status)) ?? [];
  const resolvedItems = documents.data?.items.filter(row => ["Received", "Not Applicable"].includes(row.checklist.status)) ?? [];
  const canStartDocumentMonitoring = ["Investigation", "In Progress", "With Client"].includes(workflowStatus);

  const openWorkflow = () => {
    setWorkflowTarget(actionableTargets[0] ?? "");
    setWorkflowNote("");
    setWorkflowOpen(true);
  };

  const toggleDocument = (documentTypeId: number) => setSelectedDocumentIds(current => current.includes(documentTypeId) ? current.filter(item => item !== documentTypeId) : [...current, documentTypeId]);

  if (!canCoordinate) return null;

  return <>
    {lastClientRequestAt ? <Button variant="outline" disabled><CheckCircle2 className="mr-2 h-4 w-4" />Document Monitoring Started · {formatDate(lastClientRequestAt)}</Button> : null}
    {canStartDocumentMonitoring ? <Button variant="outline" onClick={() => setDocumentsOpen(true)}><Send className="mr-2 h-4 w-4" />{lastClientRequestAt ? "Update Required Documents" : "Track Required Documents"}</Button> : null}
    {workflowStatus === "Waiting for Payment" && !paymentConfirmedAt ? <Button variant="outline" disabled={milestone.isPending} onClick={() => milestone.mutate({ id: amendmentId, milestone: "payment", note: null })}><ClipboardCheck className="mr-2 h-4 w-4" />{milestone.isPending ? "Recording…" : "Confirm Payment"}</Button> : null}
    {workflowStatus === "Waiting for Payment" && paymentConfirmedAt ? <Button variant="outline" disabled><CheckCircle2 className="mr-2 h-4 w-4" />Payment Confirmed · {formatDate(paymentConfirmedAt)}</Button> : null}
    {workflowStatus === "Ready for Signature" && !signatureReceivedAt ? <Button variant="outline" disabled={milestone.isPending} onClick={() => milestone.mutate({ id: amendmentId, milestone: "signature", note: null })}><ClipboardCheck className="mr-2 h-4 w-4" />{milestone.isPending ? "Recording…" : "Record Signature Received"}</Button> : null}
    {workflowStatus === "Ready for Signature" && signatureReceivedAt ? <Button variant="outline" disabled><CheckCircle2 className="mr-2 h-4 w-4" />Signature Received · {formatDate(signatureReceivedAt)}</Button> : null}
    {actionableTargets.length ? <Button onClick={openWorkflow}><ChevronRight className="mr-2 h-4 w-4" />Change Workflow Status</Button> : null}

    {unresolvedItems.length ? <div className="basis-full rounded-md border bg-amber-50 p-3 text-xs text-amber-900"><span className="font-semibold">Awaiting manual Canopy verification:</span> {unresolvedItems.map(row => `${row.documentTypeLabel} (${row.checklist.status})`).join(", ")}</div> : null}
    {!unresolvedItems.length && resolvedItems.length ? <div className="basis-full rounded-md border bg-emerald-50 p-3 text-xs text-emerald-900"><p className="font-semibold">Document check complete</p><div className="mt-2 space-y-1">{resolvedItems.map(row => <div key={row.checklist.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-200 bg-white/60 px-2 py-1.5"><span className="font-medium">{row.documentTypeLabel}</span><span className="font-semibold">{row.checklist.status}</span></div>)}</div><p className="mt-2">TaxAce staff may now manually move the workflow from With Client to In Progress when appropriate.</p></div> : null}

    <Dialog open={workflowOpen} onOpenChange={open => !workflowMutation.isPending && setWorkflowOpen(open)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Change Workflow Status</DialogTitle><DialogDescription>Select any allowed forward or backward transition from {workflowStatus}. This is an internal TaxAce monitoring workflow. Backward moves are recorded in Activity History and Closed remains terminal.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div><Label>Workflow Status</Label><Select disabled={workflowMutation.isPending} value={workflowTarget} onValueChange={setWorkflowTarget}><SelectTrigger className="w-full"><SelectValue placeholder="Select an allowed transition" /></SelectTrigger><SelectContent>{actionableTargets.map(target => <SelectItem key={target} value={target}>{transitionLabels[workflowStatus]?.[target] ?? target} → {target}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Transition Note (optional)</Label><Textarea disabled={workflowMutation.isPending} value={workflowNote} onChange={event => setWorkflowNote(event.target.value)} placeholder="Internal reason, handoff context, correction requested, or why the record is moving backward" /></div>
        </div>
        <DialogFooter><Button variant="outline" disabled={workflowMutation.isPending} onClick={() => setWorkflowOpen(false)}>Cancel</Button><Button disabled={!workflowTarget || workflowMutation.isPending} onClick={() => workflowMutation.mutate({ id: amendmentId, toStatus: workflowTarget as any, note: workflowNote.trim() || null })}>{workflowMutation.isPending ? "Saving…" : transitionLabels[workflowStatus]?.[workflowTarget] ?? `Move to ${workflowTarget}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={documentsOpen} onOpenChange={open => !requestDocuments.isPending && setDocumentsOpen(open)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Track Required Documents</DialogTitle><DialogDescription>This is an internal TaxAce monitoring checklist. Select the documents the team must verify in Canopy. No message, request, upload, portal action, or Canopy write-back is sent from this tool.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Workflow behavior:</span> saving required documents from Investigation or In Progress automatically moves the Amendment Record to <span className="font-semibold text-foreground">With Client</span>. The team then checks Canopy manually and marks each item Received or Not Applicable here. When all tracked items are resolved, the checklist is complete but the workflow does not advance automatically.</div>
          <div className="grid gap-2 sm:grid-cols-2">{(documents.data?.options ?? []).map(option => {
            const selected = selectedDocumentIds.includes(option.id);
            const existing = documents.data?.items.find(row => row.checklist.documentTypeId === option.id);
            return <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selected ? "border-primary bg-primary/5" : ""}`}><input type="checkbox" checked={selected} onChange={() => toggleDocument(option.id)} /><span><span className="block text-sm font-medium">{option.label}</span>{existing ? <span className="text-xs text-muted-foreground">Current: {existing.checklist.status}</span> : null}</span></label>;
          })}</div>
          <div><Label>Internal Monitoring Note (optional)</Label><Textarea value={documentNote} onChange={event => setDocumentNote(event.target.value)} placeholder="Tax year, period, what the team should verify in Canopy, or other internal context" /></div>
          {requestedItems.length ? <div className="rounded-md border bg-muted/20 p-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Awaiting Verification in Canopy</p><div className="mt-2 space-y-2">{requestedItems.map(row => <div key={row.checklist.id} className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{row.documentTypeLabel}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={updateDocument.isPending} onClick={() => updateDocument.mutate({ id: row.checklist.id, status: "Received", note: row.checklist.note })}>Verified Received</Button><Button size="sm" variant="outline" disabled={updateDocument.isPending} onClick={() => updateDocument.mutate({ id: row.checklist.id, status: "Not Applicable", note: row.checklist.note })}>Not Applicable</Button></div></div>)}</div></div> : null}
        </div>
        <DialogFooter><Button variant="outline" disabled={requestDocuments.isPending} onClick={() => setDocumentsOpen(false)}>Cancel</Button><Button disabled={requestDocuments.isPending || selectedDocumentIds.length === 0} onClick={() => requestDocuments.mutate({ amendmentId, documentTypeIds: selectedDocumentIds, note: documentNote.trim() || null })}>{requestDocuments.isPending ? "Saving…" : `Save ${selectedDocumentIds.length || ""} Required Document${selectedDocumentIds.length === 1 ? "" : "s"}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
