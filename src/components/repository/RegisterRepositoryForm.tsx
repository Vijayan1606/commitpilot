"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RegisterRepositoryForm({ workspaceRoot }: { workspaceRoot: string | null }) {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name: name.trim() || undefined }),
      });
      const payload = (await response.json()) as {
        repository?: { id: string };
        error?: { message: string; details?: unknown };
      };
      if (!response.ok || !payload.repository) {
        setError(payload.error?.message ?? "The repository could not be registered.");
        return;
      }
      router.push(`/repositories/${payload.repository.id}`);
      router.refresh();
    } catch {
      setError("The request failed. Is the web server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 px-4 py-4">
      <div className="space-y-1.5">
        <label htmlFor="repo-path" className="block text-xs font-medium">
          Absolute path to a Git repository
        </label>
        <input
          id="repo-path"
          className="input font-mono text-xs"
          placeholder={workspaceRoot ? `${workspaceRoot}/my-project` : "/absolute/path/to/repo"}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-[11px] leading-snug text-muted">
          Must be inside the workspace root{" "}
          <span className="font-mono text-ink/80">{workspaceRoot ?? "(invalid)"}</span>. Symlinks are
          resolved before the containment check.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="repo-name" className="block text-xs font-medium">
          Display name <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="repo-name"
          className="input"
          placeholder="Defaults to the folder name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={busy || !path.trim()}>
        {busy ? "Validating…" : "Register repository"}
      </button>
    </form>
  );
}
