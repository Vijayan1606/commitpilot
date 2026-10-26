import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-citron">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">That record is not here</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        The repository, analysis, patch, or report may have been removed. Nothing was fabricated to fill
        the gap.
      </p>
      <div className="flex gap-2">
        <Link className="btn btn-primary" href="/">
          Dashboard
        </Link>
        <Link className="btn" href="/repositories">
          Repositories
        </Link>
      </div>
    </div>
  );
}
