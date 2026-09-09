import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorPanel, formatDate, LoadingPanel, PageHeader } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { Activity as ActivityIcon, Search } from "lucide-react";
import { useMemo, useState } from "react";

export default function ActivityPage() {
  const [query, setQuery] = useState("");
  const activity = trpc.activity.list.useQuery({ limit: 200 });
  const rows = useMemo(() => (activity.data ?? []).filter(row => `${row.activity.action} ${row.activity.entityType} ${row.actorName ?? "System"}`.toLowerCase().includes(query.toLowerCase())), [activity.data, query]);
  if (activity.isLoading) return <LoadingPanel label="Loading permanent Activity History" />;
  if (activity.error) return <ErrorPanel message={activity.error.message} retry={() => activity.refetch()} />;
  return <div className="taxace-page"><PageHeader eyebrow="Supporting Tool" title="Activity History" description="Append-only system and user events across TaxAce amendment operations." /><Card className="taxace-card"><CardContent className="p-4"><div className="relative max-w-lg"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder="Filter action, entity, or actor" /></div></CardContent></Card>{rows.length === 0 ? <EmptyState title="No matching Activity History" description="Activity appears automatically after significant operational actions." /> : <div className="taxace-card divide-y">{rows.map(row => <article key={row.activity.id} className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto]"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"><ActivityIcon className="h-4 w-4" /></span><div><p className="text-sm font-semibold">{row.activity.action}</p><p className="mt-1 text-xs text-muted-foreground">{row.actorName || "System"} · {row.activity.entityType}{row.activity.entityId ? ` #${row.activity.entityId}` : ""}</p>{row.activity.note ? <p className="mt-2 text-sm text-muted-foreground">{row.activity.note}</p> : null}</div><time className="text-xs text-muted-foreground">{formatDate(row.activity.createdAt, true)}</time></article>)}</div>}</div>;
}
