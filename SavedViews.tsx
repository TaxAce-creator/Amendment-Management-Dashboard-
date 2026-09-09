import { Button } from "@/components/ui/button";
import { EmptyState, ErrorPanel, formatDate, hasUiCapability, LoadingPanel, PageHeader } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { Bookmark, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const routes: Record<string, string> = { "Opportunity Center": "/opportunities", "Amendment Tracker": "/amendments", Pipeline: "/pipeline", "Reporting & Analytics": "/reports", "Work Queues": "/queues" };

function buildSavedViewLocation(view: { workspace: string; filters: unknown; sortConfig: unknown; visibleColumns: unknown; grouping: unknown }) {
  const route = routes[view.workspace] || "/";
  const params = new URLSearchParams();
  const filters = view.filters && typeof view.filters === "object" ? view.filters as Record<string, unknown> : {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === "" || value === "all") continue;
    if (["string", "number", "boolean"].includes(typeof value)) params.set(key, String(value));
  }
  if (view.sortConfig && typeof view.sortConfig === "object") {
    const sort = view.sortConfig as Record<string, unknown>;
    if (typeof sort.field === "string") params.set("sort", sort.field);
    if (typeof sort.direction === "string") params.set("direction", sort.direction);
  }
  if (Array.isArray(view.visibleColumns) && view.visibleColumns.length) params.set("columns", view.visibleColumns.join(","));
  if (view.grouping && typeof view.grouping === "object") {
    const grouping = view.grouping as Record<string, unknown>;
    if (typeof grouping.field === "string") params.set("group", grouping.field);
  }
  return `${route}${params.toString() ? `?${params.toString()}` : ""}`;
}

export default function SavedViews() {
  const views = trpc.savedViews.list.useQuery();
  const bootstrap = trpc.settings.bootstrap.useQuery();
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const remove = trpc.savedViews.remove.useMutation({
    onSuccess: async () => {
      toast.success("Saved View removed");
      setPendingDeleteId(null);
      await utils.savedViews.list.invalidate();
    },
    onError: error => {
      setPendingDeleteId(null);
      toast.error(error.message);
    },
  });
  const [, setLocation] = useLocation();
  const canManage = hasUiCapability(bootstrap.data?.capabilities, "manageSharedViews");

  function confirmRemove(view: { id: number; name: string }) {
    if (remove.isPending) return;
    if (!window.confirm(`Delete Saved View "${view.name}"? This cannot be undone.`)) return;
    setPendingDeleteId(view.id);
    remove.mutate({ id: view.id });
  }

  if (views.isLoading) return <LoadingPanel />;
  if (views.error) return <ErrorPanel message={views.error.message} retry={() => views.refetch()} />;
  return <div className="taxace-page"><PageHeader eyebrow="Supporting Tool" title="Saved Views" description="Private-by-default filters, columns, sorting, grouping, and pagination preferences. Opening a Saved View restores its persisted workspace state." />{!views.data?.length ? <EmptyState title="No Saved Views" description={canManage ? "Save a working filter set from an operational workspace to return to it quickly." : "No Saved Views are available to your Viewer account."} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{views.data.map(view => <article key={view.id} className="taxace-card p-5"><div className="flex items-start gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Bookmark className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="font-semibold">{view.name}</p><p className="mt-1 text-xs text-muted-foreground">{view.workspace} · {view.shared ? "Shared" : "Private"}</p></div></div><p className="mt-4 text-xs text-muted-foreground">Updated {formatDate(view.updatedAt, true)}</p><div className="mt-5 flex gap-2"><Button size="sm" disabled={remove.isPending} onClick={() => setLocation(buildSavedViewLocation(view))}>Open View</Button>{canManage && view.userId === me.data?.id ? <Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => confirmRemove(view)} aria-label={`Delete Saved View ${view.name}`}><Trash2 className="h-4 w-4" />{pendingDeleteId === view.id ? <span className="ml-2">Deleting…</span> : null}</Button> : null}</div></article>)}</div>}</div>;
}