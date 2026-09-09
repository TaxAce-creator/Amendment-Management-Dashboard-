import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowRight, Inbox, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[30px]">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const statusStyles: Record<string, string> = {
  Investigation: "border-blue-200 bg-blue-50 text-blue-700",
  "With Client": "border-amber-200 bg-amber-50 text-amber-800",
  "In Progress": "border-cyan-200 bg-cyan-50 text-cyan-800",
  "Ready for EA Review": "border-violet-200 bg-violet-50 text-violet-800",
  "EA Review": "border-indigo-200 bg-indigo-50 text-indigo-800",
  "Waiting for Payment": "border-orange-200 bg-orange-50 text-orange-800",
  "Ready for Signature": "border-sky-200 bg-sky-50 text-sky-800",
  "Ready to File": "border-teal-200 bg-teal-50 text-teal-800",
  Filed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  "Waiting on IRS / FTB": "border-amber-200 bg-amber-50 text-amber-800",
  Accepted: "border-green-200 bg-green-50 text-green-800",
  Closed: "border-slate-200 bg-slate-100 text-slate-700",
  "Pending Review": "border-blue-200 bg-blue-50 text-blue-700",
  "Under Review": "border-violet-200 bg-violet-50 text-violet-800",
  "Ready to Create Amendment": "border-teal-200 bg-teal-50 text-teal-800",
  "No Amendment Needed": "border-slate-200 bg-slate-100 text-slate-700",
  Deferred: "border-amber-200 bg-amber-50 text-amber-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap font-medium", statusStyles[status] ?? "bg-muted text-foreground")}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {status}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const style = priority === "High" ? "border-red-200 bg-red-50 text-red-700" : priority === "Medium" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700";
  return <Badge variant="outline" className={cn("font-medium", style)}>{priority}</Badge>;
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <Card className={cn("taxace-card h-full p-4 text-left", onClick && "group hover:border-primary/40 hover:shadow-md")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        {icon ? <span className="rounded-md bg-muted p-2 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">{icon}</span> : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      {onClick ? <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">Open work <ArrowRight className="h-3 w-3" /></span> : null}
    </Card>
  );
  return onClick ? <button className="h-full w-full" onClick={onClick}>{content}</button> : content;
}

export function LoadingPanel({ label = "Loading TaxAce data" }: { label?: string }) {
  return <div className="taxace-card flex min-h-48 items-center justify-center gap-3 p-8 text-sm text-muted-foreground"><LoaderCircle className="h-5 w-5 animate-spin text-primary" />{label}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed bg-card p-8 text-center">
      <span className="mb-4 rounded-full bg-muted p-3"><Inbox className="h-6 w-6 text-muted-foreground" /></span>
      <h3 className="font-semibold">{title}</h3><p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorPanel({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-800"><AlertTriangle className="mb-3 h-6 w-6" /><p className="text-sm font-medium">{message}</p>{retry ? <Button variant="outline" className="mt-4 bg-white" onClick={retry}>Try again</Button> : null}</div>;
}

export function formatDate(value: Date | string | null | undefined, includeTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

export function formatMoney(value: number | string | null | undefined): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

export function hasUiCapability(capabilities: readonly string[] | undefined, capability: string): boolean {
  return Boolean(capabilities?.includes(capability));
}
