"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", hint: "Overview" },
  { href: "/repositories", label: "Repositories", hint: "Registry" },
  { href: "/reviews", label: "Reviews", hint: "Diffs" },
  { href: "/patches", label: "Patches", hint: "Proposals" },
  { href: "/reports", label: "Reports", hint: "Exports" },
  { href: "/settings", label: "Settings", hint: "Model & safety" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 z-30 flex h-auto flex-col border-b border-line/70 bg-panel/60 backdrop-blur lg:h-screen lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-4 py-4 lg:block lg:px-5 lg:py-6">
        <Link href="/" className="group flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-md border border-citron/40 bg-citron/10 font-mono text-sm font-bold text-citron"
          >
            CP
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight">CommitPilot AI</span>
            <span className="block text-[11px] text-muted">workflow, by conversation</span>
          </span>
        </Link>
      </div>

      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-3 lg:pb-0">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`group flex shrink-0 items-center justify-between rounded-md px-3 py-2 text-sm transition-colors lg:shrink ${
                active
                  ? "bg-citron/10 text-citron"
                  : "text-muted hover:bg-raised/70 hover:text-ink"
              }`}
            >
              <span className="font-medium">{item.label}</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-wider opacity-60 lg:block">
                {item.hint}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden border-t border-line/70 px-5 py-4 text-[11px] leading-relaxed text-muted lg:block">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted/80">Local-first</p>
        <p className="mt-1">
          Repository access stays on this machine. Open model calls are bounded and redacted.
        </p>
        <p className="mt-3 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
          MIT licensed · v0.1.0
        </p>
      </div>
    </aside>
  );
}
