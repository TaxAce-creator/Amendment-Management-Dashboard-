import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorPanel, formatDate, formatMoney, LoadingPanel, MetricCard, PageHeader, PriorityBadge, StatusBadge } from "@/components/taxace";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, CheckCircle2, Clock3, FileCheck2, FolderKanban, Hourglass, UsersRound } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocation } from "wouter";

export default function Dashboard() {
  const dashboard = trpc.reporting.dashboard.useQuery();
  const [, setLocation] = useLocation();
  if (dashboard.isLoading) return <LoadingPanel label="Loading live department operations" />;
  if (dashboard.error) return <ErrorPanel message={dashboard.error.message} retry={() => dashboard.refetch()} />;
  const data = dashboard.data;
  if (!data) return null;
  const cards = [
    ["Active Amendments", data.kpis.activeAmendments, FolderKanban, "/amendments"],
    ["Pending Review", data.kpis.pendingReview, UsersRound, "/opportunities"],
    ["Waiting on Client", data.kpis.waitingOnClient, Clock3, "/amendments?status=With%20Client"],
    ["Waiting on IRS / FTB", data.kpis.waitingOnAgency, Hourglass, "/amendments?status=Waiting%20on%20IRS%20%2F%20FTB"],
    ["Ready for EA Review", data.kpis.readyForEaReview, Activity, "/amendments?status=Ready%20for%20EA%20Review"],
    ["Ready to File", data.kpis.readyToFile, FileCheck2, "/amendments?status=Ready%20to%20File"],
    ["Overdue", data.kpis.overdue, AlertTriangle, "/queues"],
    ["Closed This Month", data.kpis.closedThisMonth, CheckCircle2, "/reports"],
  ] as const;
  return <div className="taxace-page">
    <PageHeader eyebrow="Executive Dashboard" title="Department operations" description={`Live persisted data · refreshed ${formatDate(data.generatedAt, true)}`} actions={<span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs font-medium text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />Live</span>} />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon, path]) => <MetricCard key={label} label={label} value={value} icon={<Icon className="h-4 w-4" />} onClick={() => setLocation(path)} />)}</section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Estimated Refunds" value={formatMoney(data.metrics.estimatedRefunds)} hint="Across active amendments" />
      <MetricCard label="Estimated Balances Due" value={formatMoney(data.metrics.estimatedBalancesDue)} hint="Across active amendments" />
      <MetricCard label="Average Days to Complete" value={data.metrics.averageDaysToComplete.toFixed(1)} hint="Closed Amendment Records" />
      <MetricCard label="Average Client Response" value={`${data.metrics.averageClientResponseHours.toFixed(1)} hr`} hint="Recorded request-to-response intervals" />
    </section>
    <section className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
      <Card className="taxace-card"><CardHeader className="pb-2"><CardTitle className="text-base">Amendment pipeline</CardTitle><p className="text-xs text-muted-foreground">Select a bar to open the filtered Amendment Tracker.</p></CardHeader><CardContent className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.pipeline} margin={{ top: 12, right: 8, left: -24, bottom: 46 }} onClick={(state: any) => { const status = state?.activePayload?.[0]?.payload?.status; if (status) setLocation(`/amendments?status=${encodeURIComponent(status)}`); }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="status" angle={-32} textAnchor="end" interval={0} tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#00AA91" radius={[4, 4, 0, 0]} cursor="pointer" /></BarChart></ResponsiveContainer></CardContent></Card>
      <Card className="taxace-card"><CardHeader><CardTitle className="text-base">Operational alerts</CardTitle></CardHeader><CardContent className="space-y-3">{[["Overdue work", data.alerts.overdue, "Review aging queue"], ["Unassigned work", data.alerts.unassigned, "Assign ownership"], ["Missing client action", data.alerts.missingClientAction, "Review client requests"], ["Threshold bottlenecks", data.alerts.bottlenecks.length, "Inspect pipeline congestion"]].map(([label, count, action]) => <button key={String(label)} onClick={() => setLocation("/queues")} className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:border-primary/40 hover:bg-muted/30"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-50 text-sm font-semibold text-amber-800">{count}</span><span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{action}</span></span></button>)}</CardContent></Card>
    </section>
    <section className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
      <Card className="taxace-card"><CardHeader><CardTitle className="text-base">Priority work queue</CardTitle></CardHeader><CardContent className="p-0">{data.workQueue.length === 0 ? <div className="p-5"><EmptyState title="No active work" description="Active Amendment Records will appear here after creation." /></div> : <div className="taxace-table-wrap rounded-none border-x-0 border-b-0"><table className="taxace-table"><thead><tr><th>Client</th><th>Tax Years</th><th>Priority</th><th>Next Action</th><th>Assigned</th><th>Age</th></tr></thead><tbody>{data.workQueue.map(row => <tr key={row.id} onClick={() => setLocation(`/amendments/${row.id}`)} className="cursor-pointer"><td><span className="font-medium">{row.clientName}</span><span className="block text-xs text-muted-foreground">{row.amendmentRecordId}</span></td><td>{row.taxYears.join(", ") || "—"}</td><td><PriorityBadge priority={row.priority} /></td><td className="max-w-xs truncate">{row.nextAction || "No next action recorded"}</td><td>{row.assigned || "Unassigned"}</td><td>{row.age}d</td></tr>)}</tbody></table></div>}</CardContent></Card>
      <Card className="taxace-card"><CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader><CardContent>{data.recentActivity.length === 0 ? <EmptyState title="No Activity History yet" description="System-generated history will appear after the first operational action." /> : <div className="space-y-4">{data.recentActivity.slice(0, 8).map(row => <div key={row.activity.id} className="relative border-l-2 border-primary/20 pl-4"><span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" /><p className="text-sm font-medium">{row.activity.action}</p><p className="text-xs leading-5 text-muted-foreground">{row.actorName || "System"} · {row.activity.entityType} · {formatDate(row.activity.createdAt, true)}</p></div>)}</div>}</CardContent></Card>
    </section>
    <Card className="taxace-card"><CardHeader><CardTitle className="text-base">Tax Year Distribution</CardTitle></CardHeader><CardContent className="h-[260px]">{data.taxYearDistribution.length === 0 ? <EmptyState title="No Tax Year Records" description="Distribution becomes available after Amendment Records are created." /> : <ResponsiveContainer width="100%" height="100%"><BarChart data={data.taxYearDistribution}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="taxYear" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#2E7BB4" radius={[5,5,0,0]} onClick={(entry: any) => setLocation(`/amendments?taxYear=${entry.taxYear}`)} /></BarChart></ResponsiveContainer>}</CardContent></Card>
  </div>;
}
