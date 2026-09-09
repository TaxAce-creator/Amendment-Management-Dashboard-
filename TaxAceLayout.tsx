import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bookmark,
  BriefcaseBusiness,
  ChevronRight,
  CircleAlert,
  Columns3,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

type NavItem = { label: string; path: string; icon: typeof LayoutDashboard; capability?: string };
const OFFICIAL_TAXACE_LOGO = "/brand/taxace-logo.png";
const navGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: "Workspaces", items: [
    { label: "Dashboard", path: "/", icon: LayoutDashboard },
    { label: "Opportunity Center", path: "/opportunities", icon: BriefcaseBusiness },
    { label: "Amendment Tracker", path: "/amendments", icon: Columns3 },
    { label: "Pipeline", path: "/pipeline", icon: BarChart3 },
    { label: "Reporting & Analytics", path: "/reports", icon: BarChart3 },
  ] },
  { label: "Supporting tools", items: [
    { label: "Activity History", path: "/activity", icon: Activity },
    { label: "Work Queues", path: "/queues", icon: UsersRound },
    { label: "Global Search", path: "/search", icon: Search },
    { label: "Saved Views", path: "/saved-views", icon: Bookmark },
  ] },
  { label: "Administration", items: [{ label: "Settings", path: "/settings", icon: Settings, capability: "manageSettings" }] },
];

function Navigation({ capabilities, location, go }: { capabilities: readonly string[]; location: string; go: (path: string) => void }) {
  return <nav className="flex-1 overflow-y-auto px-3 py-4">{navGroups.map(group => {
    const visible = group.items.filter(item => !item.capability || capabilities.includes(item.capability));
    if (!visible.length) return null;
    return <div key={group.label} className="mb-6"><p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/45">{group.label}</p><div className="space-y-1">{visible.map(item => {
      const active = item.path === "/" ? location === "/" : location.startsWith(item.path);
      return <button key={item.path} onClick={() => go(item.path)} className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", active && "bg-sidebar-primary/15 text-white shadow-[inset_3px_0_0_#00AA91]")}><item.icon className={cn("h-4 w-4", active && "text-primary")} /><span className="flex-1">{item.label}</span>{active ? <ChevronRight className="h-3.5 w-3.5 text-primary" /> : null}</button>;
    })}</div></div>;
  })}</nav>;
}

function NotificationCenter({ go }: { go: (path: string) => void }) {
  const notifications = trpc.notifications.center.useQuery(undefined, { refetchInterval: 60_000, staleTime: 20_000 });
  const count = notifications.data?.activeCount ?? 0;
  const critical = notifications.data?.criticalCount ?? 0;
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={count ? `${count} operational notifications` : "Notifications"} className="relative">
        <Bell className="h-4 w-4" />
        {count ? <span className={cn("absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white", critical ? "bg-red-600" : "bg-primary")}>{count > 99 ? "99+" : count}</span> : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[390px] max-w-[calc(100vw-2rem)] p-0">
      <div className="border-b px-4 py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Operational alerts</p><p className="text-xs text-muted-foreground">Derived from persisted TaxAce work assigned to you.</p></div>{critical ? <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700"><AlertTriangle className="h-3 w-3" />{critical} critical</span> : null}</div></div>
      <div className="max-h-[430px] overflow-y-auto">
        {notifications.isLoading ? <div className="p-4 text-sm text-muted-foreground">Loading operational alerts…</div> : notifications.error ? <div className="p-4 text-sm text-red-700">Could not load alerts.</div> : !notifications.data?.alerts.length ? <div className="p-6 text-center"><CircleAlert className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No active alerts</p><p className="mt-1 text-xs text-muted-foreground">Your enabled notification categories have no matching work right now.</p></div> : notifications.data.alerts.map(alert => <button key={alert.id} onClick={() => go(alert.href)} className="flex w-full gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/40"><span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", alert.severity === "critical" ? "bg-red-600" : alert.severity === "warning" ? "bg-amber-500" : "bg-primary")} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{alert.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{alert.detail}</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{alert.category}</span></span></button>)}
      </div>
      <div className="border-t bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">Notification categories are controlled in Settings. Email/SMS delivery is not enabled.</div>
    </PopoverContent>
  </Popover>;
}

export default function TaxAceLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const bootstrap = trpc.settings.bootstrap.useQuery(undefined, { enabled: Boolean(user), retry: 1 });
  const capabilities = useMemo(() => bootstrap.data?.capabilities ?? [], [bootstrap.data?.capabilities]);

  if (loading) return <div className="taxace-grid-lines flex min-h-screen items-center justify-center bg-[#f5f7f9] p-6"><div className="rounded-xl border bg-white px-7 py-6 shadow-lg"><img src={OFFICIAL_TAXACE_LOGO} alt="TaxAce" className="h-12 w-auto max-w-[220px] object-contain" /><p className="mt-4 text-xs text-muted-foreground">Opening amendment operations…</p></div></div>;
  if (!user) return <div className="taxace-grid-lines flex min-h-screen items-center justify-center p-6"><div className="w-full max-w-md rounded-xl border bg-white p-8 shadow-xl"><img src={OFFICIAL_TAXACE_LOGO} alt="TaxAce" className="h-auto w-full max-w-[300px] object-contain" /><div className="mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary"><ShieldCheck className="h-4 w-4" />Internal operations</div><h1 className="mt-3 text-2xl font-semibold tracking-tight">Amendment Management</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Sign in with your authorized account to access TaxAce amendment operations.</p><Button className="mt-7 w-full" size="lg" onClick={() => startLogin()}>Sign in to TaxAce</Button></div></div>;

  const go = (path: string) => { setLocation(path); setMobileOpen(false); };
  return <div className="min-h-screen bg-background">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] flex-col bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-28 items-center border-b border-sidebar-border px-5"><div className="flex w-full flex-col items-start gap-2"><img src={OFFICIAL_TAXACE_LOGO} alt="TaxAce" className="h-auto w-full max-w-[180px] object-contain drop-shadow-[0_1px_1px_rgba(255,255,255,0.34)]" /><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/65">Amendment Management Dashboard</p></div></div>
      <Navigation capabilities={capabilities} location={location} go={go} />
      <div className="border-t border-sidebar-border p-4"><div className="flex items-center gap-3"><Avatar className="h-9 w-9 border border-white/10"><AvatarFallback className="bg-primary/15 text-primary">{user.name?.slice(0, 2).toUpperCase() || "TA"}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white">{user.name || "TaxAce User"}</p><p className="truncate text-xs text-sidebar-foreground/50">{user.role}</p></div><button onClick={logout} aria-label="Sign out" className="rounded-md p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-white"><LogOut className="h-4 w-4" /></button></div></div>
    </aside>
    <div className="lg:pl-[260px]">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-white/95 px-4 backdrop-blur lg:px-7">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden"><Menu className="h-5 w-5" /><span className="sr-only">Open navigation</span></Button></SheetTrigger><SheetContent side="left" className="w-[280px] border-0 bg-sidebar p-0 text-sidebar-foreground"><SheetTitle className="sr-only">TaxAce navigation</SheetTitle><div className="flex h-28 items-center border-b border-sidebar-border px-5"><div className="flex w-full flex-col items-start gap-2"><img src={OFFICIAL_TAXACE_LOGO} alt="TaxAce" className="h-auto w-full max-w-[185px] object-contain drop-shadow-[0_1px_1px_rgba(255,255,255,0.34)]" /><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/65">Amendment Management Dashboard</p></div></div><Navigation capabilities={capabilities} location={location} go={go} /></SheetContent></Sheet>
        <form className="relative max-w-xl flex-1" onSubmit={event => { event.preventDefault(); if (query.trim().length > 1) go(`/search?q=${encodeURIComponent(query.trim())}`); }}><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search clients, tax years, reasons, preparers, statuses…" className="h-9 border-0 bg-muted/70 pl-9 shadow-none focus-visible:bg-white" aria-label="Global Search" /></form>
        <NotificationCenter go={go} />
        <div className="hidden border-l pl-4 text-right sm:block"><p className="text-xs font-medium">{user.name || "TaxAce User"}</p><p className="text-[11px] text-muted-foreground">{user.role}</p></div>
      </header>
      <main className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-7">{children}</main>
    </div>
  </div>;
}
