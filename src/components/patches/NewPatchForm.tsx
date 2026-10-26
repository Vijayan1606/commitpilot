"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewPatchForm({
  repositories,
  initialRepositoryId,
  initialFindingId,
}: {
  repositories: { id: string; name: string }[];
  initialRepositoryId?: string;
  initialFindingId?: string;
}) {
  const router = useRouter();
  const [repositoryId, setRepositoryId] = useState(initialRepositoryId ?? repositories[0]?.id ?? "");
  const [request, setRequest] = useState("");
  const [files, setFiles] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const filePaths = files
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 5);
      const response = await fetch("/api/patches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryId,
          request,
          ...(filePaths.length > 0 ? { filePaths } : {}),
          ...(initialFindingId ? { findingId: initialFindingId } : {}),
        }),
      });
      const payload = (await response.json()) as {
        patch?: { id: string };
        error?: { message: string };
      };
      if (!response.ok || !payload.patch) {
        setError(payload.error?.message ?? "The patch could not be proposed.");
        return;
      }
      router.push(`/patches/${payload.patch.id}`);
      router.refresh();
    } catch {
      setError("The request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (repositories.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted">
        Register a repository before proposing a patch.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="space-y-1.5">
        <label htmlFor="patch-repo" className="block text-xs font-medium">
          Repository
        </label>
        <select
          id="patch-repo"
          className="input"
          value={repositoryId}
          onChange={(event) => setRepositoryId(event.target.value)}
          required
        >
          {repositories.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="patch-request" className="block text-xs font-medium">
          What should the patch change?
        </label>
        <textarea
          id="patch-request"
          className="input min-h-[80px] resize-y"
          placeholder="Fix the missing expiry check in the session verifier and add a regression test."
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          minLength={5}
          maxLength={2000}
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="patch-files" className="block text-xs font-medium">
          Target files <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="patch-files"
          className="input min-h-[52px] resize-y font-mono text-xs"
          placeholder="src/auth/session.ts"
          value={files}
          onChange={(event) => setFiles(event.target.value)}
        />
        <p className="text-[11px] text-muted">One per line. The model may only touch tracked files.</p>
      </div>

      {initialFindingId ? (
        <p className="rounded border border-info/30 bg-info/5 px-3 py-2 text-[11px] text-info">
          Anchored to finding <span className="font-mono">{initialFindingId.slice(0, 20)}…</span>
        </p>
      ) : null}

      <p className="rounded border border-line bg-raised/50 px-3 py-2 text-[11px] leading-relaxed text-muted">
        The model returns a unified diff. CommitPilot validates every path and runs{" "}
        <span className="font-mono">git apply --check</span>. Nothing is written until you approve the
        proposal.
      </p>

      {error ? (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={busy || request.trim().length < 5}>
        {busy ? "Generating and validating…" : "Propose patch"}
      </button>
    </form>
  );
}
