import { Button } from "@/components/ui/button";
import { EmptyState, ErrorPanel, LoadingPanel, PageHeader, PriorityBadge, StatusBadge } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";

const modes = ["My Queue", "Unassigned", "EA Review", "All Items"] as const;
export default function WorkQueues() {
  const [mode, setMode] = useState<(typeof modes)[number]>("My Queue");
  const queue = trpc.operationalViews.workQueue.useQuery({ mode });
  const [, setLocation] = useLocation();
  return <div className="taxace-page"><PageHeader eyebrow="Supporting Tool" title="Work Queues" description="Role-aware operational queues for current ownership, Assigned Preparer responsibility, EA review, and unassigned work." /><div className="flex flex-wrap gap-2">{modes.map(item => <Button key={item} variant={mode === item ? "default" : "outline"} onClick={() => setMode(item)}>{item}</Button>)}</div>{queue.isLoading ? <LoadingPanel /> : queue.error ? <ErrorPanel message={queue.error.message} retry={() => queue.refetch()} /> : !queue.data?.length ? <EmptyState title={`No items in ${mode}`} description="Queue contents update automatically after committed workflow and assignment changes." /> : <div className="taxace-table-wrap"><table className="taxace-table"><thead><tr><th>Client</th><th>Amendment Record ID</th><th>Priority</th><th>Workflow Status</th><th>Assigned Preparer</th><th>EA Reviewer</th><th>Current Owner</th><th>Canopy Source</th><th>Next Action</th></tr></thead><tbody>{queue.data.map(row => { const source = row.sourceContexts[0]; return <tr key={row.amendment.id} onClick={() => setLocation(`/amendments/${row.amendment.id}`)} className="cursor-pointer"><td className="font-medium">{row.client.clientName}</td><td>{row.amendment.amendmentRecordId}</td><td><PriorityBadge priority={row.amendment.priority} /></td><td><StatusBadge status={row.amendment.workflowStatus} /></td><td>{row.assignedPreparerName || "Unassigned"}</td><td>{row.assignedEaReviewerName || "Unassigned"}</td><td>{row.currentOwnerName || "Unassigned"}</td><td className="max-w-xs"><span className="block truncate">{source?.parentTask || "—"}</span>{source ? <span className="text-[11px] text-muted-foreground">{source.returnType}</span> : null}</td><td className="max-w-md truncate">{row.amendment.nextAction || "—"}</td></tr>; })}</tbody></table></div>}</div>;
}
