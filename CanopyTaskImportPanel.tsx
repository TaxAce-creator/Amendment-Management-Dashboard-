import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, StatusBadge } from "@/components/taxace";
import { trpc } from "@/lib/trpc";

export function CanopyTaskImportPanel() {
  const utils = trpc.useUtils();
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<{ id: number; sourceExportedAtRequired: boolean; sourceExportedAt: string | null } | null>(null);
  const [sourceExportedAt, setSourceExportedAt] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const history = trpc.imports.history.useQuery();
  const reference = trpc.imports.headerReference.useQuery();
  const createUpload = trpc.imports.createUpload.useMutation({ onError: error => toast.error(error.message) });
  const saveTimestamp = trpc.imports.setSourceExportedAt.useMutation({ onError: error => toast.error(error.message) });
  const validate = trpc.imports.validate.useMutation({
    onSuccess: value => {
      setPreview(value);
      toast.success("Canopy Task Import validation complete");
      utils.imports.history.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const commit = trpc.imports.commit.useMutation({
    onSuccess: () => {
      toast.success("Canopy Task Import committed");
      setFile(null);
      setBatch(null);
      setSourceExportedAt("");
      setPreview(null);
      utils.imports.history.invalidate();
      utils.opportunities.list.invalidate();
      utils.reporting.dashboard.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const cancel = trpc.imports.cancel.useMutation({
    onSuccess: () => {
      toast.success("Canopy Task Import cancelled");
      setFile(null);
      setBatch(null);
      setSourceExportedAt("");
      setPreview(null);
      utils.imports.history.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const blocked = Boolean(preview && (preview.counts.rejected > 0 || preview.counts.conflicts > 0));
  const busy = createUpload.isPending || saveTimestamp.isPending || validate.isPending || commit.isPending || cancel.isPending;
  const visibleRows = useMemo(() => preview?.rows?.slice(0, 300) ?? [], [preview]);

  async function uploadAndPrepare() {
    if (!file) return;
    try {
      const contentType = file.type || "application/octet-stream";
      const created = await createUpload.mutateAsync({ filename: file.name, contentType });
      const response = await fetch(`/api/imports/${created.id}/upload`, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Protected upload failed with HTTP ${response.status}.`);
      setBatch({ id: created.id, sourceExportedAtRequired: created.sourceExportedAtRequired, sourceExportedAt: created.sourceExportedAt });
      if (created.sourceExportedAtRequired) {
        toast.info("File uploaded. Enter Source Exported At before validation.");
        return;
      }
      await validate.mutateAsync({ id: created.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Canopy file upload failed.");
    }
  }

  async function validateWithTimestamp() {
    if (!batch || !sourceExportedAt) return;
    const parsed = new Date(sourceExportedAt);
    if (Number.isNaN(parsed.getTime())) {
      toast.error("Enter a valid Source Exported At value.");
      return;
    }
    await saveTimestamp.mutateAsync({ id: batch.id, sourceExportedAt: parsed.toISOString() });
    await validate.mutateAsync({ id: batch.id });
  }

  function downloadHeaderReference() {
    if (!reference.data) return;
    const url = URL.createObjectURL(new Blob([reference.data.content], { type: reference.data.contentType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reference.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="space-y-5">
    <Card className="taxace-card">
      <CardHeader><CardTitle className="text-base">Canopy Task Import</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          <p className="font-semibold">Manual Canopy task-export boundary</p>
          <p className="mt-1 leading-6">Upload a Canopy Tasks CSV or Excel export. TaxAce stores source provenance and creates pending source work-group reviews only. It does not call Canopy APIs, write back to Canopy, or create Amendment Records automatically.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-muted/20 p-6 text-center">
            <Upload className="h-6 w-6 text-primary" />
            <span className="mt-2 text-sm font-medium">{file ? file.name : "Choose Canopy .csv or .xlsx export"}</span>
            <span className="mt-1 text-xs text-muted-foreground">Required source columns: Pinned, Status, Task, Client, Task Type, Parent Task, Tax Year, Return Type, Due date, Assignee</span>
            <input type="file" accept=".csv,.xlsx" disabled={busy} className="sr-only" onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); setBatch(null); setSourceExportedAt(""); }} />
          </label>
          <div className="flex flex-col gap-2">
            <Button disabled={!file || busy} onClick={uploadAndPrepare}>{busy ? "Working…" : "Upload & Validate"}</Button>
            <Button variant="outline" disabled={busy} onClick={downloadHeaderReference}><Download className="mr-2 h-4 w-4" />Download Header Reference</Button>
          </div>
        </div>
        {batch?.sourceExportedAtRequired && !preview ? <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 md:grid-cols-[1fr_auto]">
          <div><Label htmlFor="source-exported-at">Source Exported At</Label><Input id="source-exported-at" type="datetime-local" disabled={busy} className="mt-1" value={sourceExportedAt} onChange={event => setSourceExportedAt(event.target.value)} /><p className="mt-1 text-xs text-amber-900">The export timestamp could not be derived from the filename. Enter the timestamp represented by the Canopy export.</p></div>
          <div className="flex items-end"><Button disabled={!sourceExportedAt || busy} onClick={validateWithTimestamp}>Validate Export</Button></div>
        </div> : null}
      </CardContent>
    </Card>

    {preview ? <Card className="taxace-card">
      <CardHeader><CardTitle className="text-base">Validation Preview</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[["Source Rows", preview.counts.totalRows], ["Clients", preview.counts.clients], ["Work Groups", preview.counts.workGroups], ["Logical Clusters", preview.counts.logicalClusters], ["Changed", preview.counts.changed], ["Conflicts", preview.counts.conflicts]].map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{String(value)}</p></div>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {Object.entries({ New: preview.counts.new, Unchanged: preview.counts.unchanged, "Older Snapshot": preview.counts.olderSnapshots, "Duplicate Occurrences": preview.counts.duplicateOccurrences, Rejected: preview.counts.rejected, Accepted: preview.counts.acceptedRows, "Extra Columns": preview.extraHeaders.length }).map(([label, value]) => <div key={label} className="rounded-lg border p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{String(value)}</p></div>)}
        </div>
        <div className="rounded-lg border bg-muted/20 p-3 text-sm"><span className="font-semibold">Source Exported At:</span> {preview.sourceExportedAt ? formatDate(preview.sourceExportedAt, true) : "Not set"} · <span className="font-semibold">Parser:</span> {preview.parserVersion}</div>
        {blocked ? <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertTriangle className="h-5 w-5 shrink-0" />Commit is blocked until rejected rows or conflicting logical task rows are corrected in a new source export.</div> : <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-5 w-5 shrink-0" />Validation passed. Missing rows from newer snapshots will never delete or close prior source records.</div>}
        <div className="taxace-table-wrap max-h-[520px] overflow-auto"><table className="taxace-table"><thead><tr><th>Row</th><th>Client</th><th>Parent Task</th><th>Task</th><th>Tax Year</th><th>Return Type</th><th>Canopy Status</th><th>Due Date</th><th>Assignee</th><th>Outcome</th></tr></thead><tbody>{visibleRows.map((row: any) => <tr key={row.sourceRowNumber}><td>{row.sourceRowNumber}</td><td className="font-medium">{row.client}</td><td>{row.parentTask}</td><td>{row.task}</td><td>{row.taxYear ?? "—"}</td><td>{row.returnType}</td><td><StatusBadge status={row.sourceStatus || "No status"} /></td><td>{row.sourceDueDate || "—"}</td><td>{row.sourceAssigneeRaw || "—"}</td><td>{row.action}</td></tr>)}</tbody></table></div>
        <div className="flex flex-wrap gap-2"><Button disabled={blocked || busy || !batch} onClick={() => batch && commit.mutate({ id: batch.id })}>{commit.isPending ? "Committing…" : "Confirm & Commit"}</Button><Button variant="outline" disabled={!batch || busy} onClick={() => batch && cancel.mutate({ id: batch.id })}>{cancel.isPending ? "Cancelling…" : "Cancel Batch"}</Button></div>
      </CardContent>
    </Card> : null}

    <Card className="taxace-card">
      <CardHeader><CardTitle className="text-base">Canopy Task Import History</CardTitle></CardHeader>
      <CardContent>{history.data?.length ? <div className="taxace-table-wrap"><table className="taxace-table"><thead><tr><th>Batch</th><th>Filename</th><th>Source Exported At</th><th>Uploaded By</th><th>Rows</th><th>Clients</th><th>Work Groups</th><th>New</th><th>Changed</th><th>Unchanged</th><th>Conflicts</th><th>Rejected</th><th>Status</th></tr></thead><tbody>{history.data.map(item => <tr key={item.batch.id}><td className="font-medium">{item.batch.batchId}</td><td>{item.batch.originalFilename}</td><td>{item.batch.sourceExportedAt ? formatDate(item.batch.sourceExportedAt, true) : "—"}</td><td>{item.uploaderName || "TaxAce user"}</td><td>{item.batch.totalRows}</td><td>{item.batch.clientCount}</td><td>{item.batch.workGroupCount}</td><td>{item.batch.newCount}</td><td>{item.batch.changedCount}</td><td>{item.batch.unchangedCount}</td><td>{item.batch.conflictCount}</td><td>{item.batch.rejectedCount}</td><td><StatusBadge status={item.batch.status} /></td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No Canopy Task Import batches yet.</p>}</CardContent>
    </Card>
  </div>;
}