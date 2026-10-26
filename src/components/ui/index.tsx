import type { ReactNode } from "react";
import { SEVERITIES, type Severity } from "@/shared/constants";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-line/70 px-5 py-6 sm:px-8 sm:py-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="label">{eyebrow}</p> : null}
        <h1 className="mt-1.5 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={`panel ${className}`}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line/80 bg-panel/40 px-6 py-12 text-center">
      <div
        aria-hidden="true"
        className="grid h-10 w-10 place-items-center rounded-full border border-line bg-raised font-mono text-muted"
      >
        ∅
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "danger" | "warn" | "ok";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warn"
        ? "text-warn"
        : tone === "ok"
          ? "text-ok"
          : "text-ink";
  return (
    <div className="panel-raised px-4 py-3">
      <p className="label">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "border-danger/50 bg-danger/15 text-danger",
  high: "border-danger/40 bg-danger/10 text-danger",
  medium: "border-warn/40 bg-warn/10 text-warn",
  low: "border-info/40 bg-info/10 text-info",
  info: "border-line bg-raised text-muted",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${SEVERITY_CLASS[severity]}`}
    >
      {severity}
    </span>
  );
}

export function SeverityBar({ counts, total }: { counts: Record<Severity, number>; total: number }) {
  if (total === 0) {
    return (
      <div className="h-2 w-full rounded-full bg-raised" aria-hidden="true" />
    );
  }
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
      {SEVERITIES.map((severity) => {
        const width = (counts[severity] / total) * 100;
        if (width === 0) return null;
        const color =
          severity === "critical" || severity === "high"
            ? "bg-danger"
            : severity === "medium"
              ? "bg-warn"
              : severity === "low"
                ? "bg-info"
                : "bg-muted";
        return <span key={severity} className={color} style={{ width: `${width}%` }} />;
      })}
    </div>
  );
}

const VERIFICATION_LABEL: Record<string, { text: string; className: string }> = {
  static_rule_match: { text: "static rule", className: "border-warn/40 bg-warn/10 text-warn" },
  path_verified_model_hypothesis: {
    text: "path verified · AI",
    className: "border-info/40 bg-info/10 text-info",
  },
  unverified_model_hypothesis: {
    text: "unverified · AI",
    className: "border-line bg-raised text-muted",
  },
  needs_manual_verification: {
    text: "manual check",
    className: "border-warn/40 bg-warn/10 text-warn",
  },
  verified_by_test: { text: "verified by test", className: "border-ok/40 bg-ok/10 text-ok" },
};

export function VerificationBadge({ status }: { status: string }) {
  const entry = VERIFICATION_LABEL[status] ?? { text: status, className: "border-line bg-raised text-muted" };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] ${entry.className}`}>
      {entry.text}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "info" }) {
  const map = {
    neutral: "border-line bg-raised text-muted",
    ok: "border-ok/40 bg-ok/10 text-ok",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-danger/40 bg-danger/10 text-danger",
    info: "border-info/40 bg-info/10 text-info",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${map[tone]}`}>
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  title?: string;
  children: ReactNode;
}) {
  const map = {
    info: "border-info/30 bg-info/5",
    warn: "border-warn/30 bg-warn/5",
    danger: "border-danger/30 bg-danger/5",
    ok: "border-ok/30 bg-ok/5",
  } as const;
  const text = {
    info: "text-info",
    warn: "text-warn",
    danger: "text-danger",
    ok: "text-ok",
  } as const;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${map[tone]}`}>
      {title ? <p className={`text-xs font-semibold uppercase tracking-wider ${text[tone]}`}>{title}</p> : null}
      <div className="mt-1 leading-relaxed text-ink/90">{children}</div>
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
