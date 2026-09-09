import { Input } from "@/components/ui/input";
import { EmptyState, ErrorPanel, LoadingPanel, PageHeader, StatusBadge } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { Search } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function GlobalSearch() {
  const initial = new URLSearchParams(window.location.search).get("q") ?? "";
  const [query, setQuery] = useState(initial);
  const results = trpc.operationalViews.search.useQuery({ query }, { enabled: query.trim().length >= 2 });
  const [, setLocation] = useLocation();
  const total = (results.data?.amendments.length ?? 0) + (results.data?.sourceWorkGroups.length ?? 0);
  return <div className="taxace-page">
    <PageHeader eyebrow="Supporting Tool" title="Global Search" description="Search TaxAce Amendment Records and imported Canopy source work groups. Canopy source facts remain distinct from TaxAce workflow data." />
    <div className="taxace-card p-4"><div className="relative max-w-2xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={query} onChange={event => { setQuery(event.target.value); window.history.replaceState({}, "", `/search?q=${encodeURIComponent(event.target.value)}`); }} className="h-11 pl-9" placeholder="Client, record ID, Parent Task, Return Type, preparer, source assignee, or status" /></div></div>
    {query.length < 2 ? <EmptyState title="Enter at least two characters" description="Search covers Amendment Records plus traceable Canopy Source Work Groups." /> : results.isLoading ? <LoadingPanel label="Searching TaxAce and Canopy source records" /> : results.error ? <ErrorPanel message={results.error.message} retry={() => results.refetch()} /> : total === 0 ? <EmptyState title="No records found" description="Try a client name, TaxAce record ID, Parent Task, Return Type, status, or assigned person." /> : <div className="grid gap-4 lg:grid-cols-2">
      <section className="taxace-card p-4"><h2 className="text-sm font-semibold">Amendment Records</h2><p className="mt-1 text-xs text-muted-foreground">TaxAce operational records</p><div className="mt-3 divide-y">{results.data?.amendments.length ? results.data.amendments.map(row => <button key={row.amendment.id} onClick={() => setLocation(`/amendments/${row.amendment.id}`)} className="flex w-full items-center justify-between gap-4 py-3 text-left"><span className="min-w-0"><span className="block truncate text-sm font-medium">{row.client.clientName}</span><span className="block truncate text-xs text-muted-foreground">{row.amendment.amendmentRecordId} · {row.assignedPreparerName || "Unassigned preparer"}</span></span><StatusBadge status={row.amendment.workflowStatus} /></button>) : <p className="py-4 text-sm text-muted-foreground">No Amendment Records match.</p>}</div></section>
      <section className="taxace-card p-4"><h2 className="text-sm font-semibold">Canopy Source Work Groups</h2><p className="mt-1 text-xs text-muted-foreground">Imported source context only — not Amendment Records</p><div className="mt-3 divide-y">{results.data?.sourceWorkGroups.length ? results.data.sourceWorkGroups.map(row => <button key={row.id} onClick={() => setLocation(`/opportunities?sourceWorkGroupId=${row.id}`)} className="block w-full py-3 text-left"><p className="text-sm font-medium">{row.clientName}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.parentTask} · {row.returnType}</p><p className="mt-1 text-[11px] text-muted-foreground">{row.taxaceClientRecordId || "TaxAce Client Record"} · Source Work Group #{row.id}</p></button>) : <p className="py-4 text-sm text-muted-foreground">No Canopy Source Work Groups match.</p>}</div></section>
    </div>}
  </div>;
}
