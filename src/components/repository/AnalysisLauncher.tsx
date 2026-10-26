"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AnalysisTab = "repository_analysis" | "code_review" | "test_gaps" | "security_review";

interface PreviewPayload {
  files: { path: string; chars: number; truncated: boolean; redactions: number }[];
  totalChars: number;
  omitted: number;
  truncated: boolean;
  model: { configured: boolean; provider: string; name: string | null; hosted: boolean };
  note: string;
}

const TABS: { id: AnalysisTab; label: string; placeholder: string; needsModel: boolean }[] = [
  {
    id: "repository_analysis",
    label: "Analyse",
    placeholder: "Explain the architecture and identify the five most important issues.",
    needsModel: true,
  },
  {
    id: "code_review",
    label: "Review diff",
    placeholder: "Review my current changes for correctness, security, and missing tests.",
    needsModel: true,
  },
  {
    id: "test_gaps",
    label: "Test gaps",
    placeholder: "Which important modules have no tests?",
    needsModel: false,
  },
  {
    id: "security_review",
    label: "Security",
    placeholder: "Look for security weaknesses that need investigation.",
    needsModel: false,
  },
];

export function AnalysisLauncher({
  repositoryId,
  modelConfigured,
  hasChanges,
}: {
  repositoryId: string;
  modelConfigured: boolean;
  hasChanges: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<AnalysisTab>("repository_analysis");
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"both" | "unstaged" | "staged" | "commit_range">("both");
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const active = (TABS.find((entry) => entry.id === tab) ?? TABS[0])!;

  async function loadPreview() {
    setPreviewBusy(true);
    setPreview(null);
    setError(null);
    try {
      const response = await fetch("/api/previews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryId,
          type: tab,
          question: question.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as PreviewPayload & { error?: { message: string } };
      if (!response.ok) {
        setError(payload.error?.message ?? "The context preview could not be built.");
        return;
      }
      setPreview(payload);
    } catch {
      setError("The preview request failed.");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryId,
          type: tab,
          question: question.trim() || undefined,
          ...(tab === "code_review" ? { mode, range: mode === "commit_range" ? range : null } : {}),
        }),
      });
      const payload = (await response.json()) as {
        job?: { id: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.job) {
        setError(payload.error?.message ?? "The analysis could not be started.");
        return;
      }
      router.push(`/analysis/${payload.job.id}`);
    } catch {
      setError("The request failed. Is the web server running?");
    } finally {
      setBusy(false);
    }
  }

  const blocked = active.needsModel && !modelConfigured;

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-1 border-b border-line/60 px-3 py-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-pressed={tab === entry.id}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              tab === entry.id ? "bg-citron/15 text-citron" : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted">
          real evidence · bounded context
        </span>
      </div>

      <form onSubmit={submit} className="space-y-3 px-4 py-4">
        <label htmlFor="analysis-question" className="block text-xs font-medium">
          What should Alan look at?
        </label>
        <textarea
          id="analysis-question"
          className="input min-h-[76px] resize-y"
          placeholder={active.placeholder}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={2000}
        />

        {tab === "code_review" ? (
          <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div>
              <label htmlFor="diff-mode" className="block text-[11px] text-muted">
                Diff mode
              </label>
              <select
                id="diff-mode"
                className="input mt-1"
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="both">All uncommitted</option>
                <option value="unstaged">Unstaged only</option>
                <option value="staged">Staged only</option>
                <option value="commit_range">Commit range</option>
              </select>
            </div>
            {mode === "commit_range" ? (
              <div>
                <label htmlFor="diff-range" className="block text-[11px] text-muted">
                  Range
                </label>
                <input
                  id="diff-range"
                  className="input mt-1 font-mono text-xs"
                  placeholder="main..HEAD"
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "code_review" && !hasChanges ? (
          <p className="text-[11px] text-warn">
            The working tree looks clean. The review will complete with no findings instead of inventing
            problems.
          </p>
        ) : null}

        {!active.needsModel ? (
          <p className="text-[11px] leading-relaxed text-muted">
            Deterministic rules run even without a model. If a model is configured, it reviews the leads and
            adds evidence-linked hypotheses.
          </p>
        ) : null}

        {blocked ? (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            An open model must be configured before this analysis can run.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-muted">Runs in the background and saves a report.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => void loadPreview()}
              disabled={previewBusy}
            >
              {previewBusy ? "Building preview…" : "Preview context"}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || blocked}>
              {busy ? "Starting…" : "Run analysis"}
            </button>
          </div>
        </div>

        {preview ? (
          <div className="rounded-lg border border-line bg-canvas/60 px-3 py-3 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-ink">Exact context for this request</p>
              <p className="font-mono text-muted">
                {preview.files.length} files · {Math.round(preview.totalChars / 1000)}k chars
              </p>
            </div>
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto font-mono">
              {preview.files.slice(0, 20).map((file) => (
                <li key={file.path} className="flex items-center justify-between gap-2 text-muted">
                  <span className="truncate">{file.path}</span>
                  <span className="shrink-0">
                    {file.redactions > 0 ? `${file.redactions} redacted · ` : ""}
                    {Math.round(file.chars / 1000)}k
                  </span>
                </li>
              ))}
            </ul>
            {preview.files.length > 20 ? (
              <p className="mt-1 text-muted">+{preview.files.length - 20} more files</p>
            ) : null}
            <p className="mt-2 text-muted">
              {preview.omitted > 0 ? `${preview.omitted} files omitted. ` : ""}
              {preview.truncated ? "Some files truncated. " : ""}
              Model: <span className="font-mono">{preview.model.name ?? "not configured"}</span>
              {preview.model.hosted ? " (hosted)" : " (local)"}. Excluded paths are never included.
            </p>
          </div>
        ) : null}
      </form>
    </div>
  );
}