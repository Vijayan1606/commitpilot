"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PatchDecision({
  patchId,
  status,
  applyEnabled,
}: {
  patchId: string;
  status: string;
  applyEnabled: boolean;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ changedFiles: string[]; backupDirectory: string | null } | null>(
    null,
  );

  async function submit(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/patches/${patchId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, confirm: true }),
      });
      const payload = (await response.json()) as {
        changedFiles?: string[];
        backupDirectory?: string | null;
        error?: { message: string };
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "The decision could not be recorded.");
        return;
      }
      setOutcome({
        changedFiles: payload.changedFiles ?? [],
        backupDirectory: payload.backupDirectory ?? null,
      });
      setDecision(null);
      router.refresh();
    } catch {
      setError("The request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "applied") {
    return (
      <div className="space-y-2 px-4 py-4">
        <p className="rounded border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
          This patch has been applied. Use your Git history to review or revert it.
        </p>
        {outcome?.backupDirectory ? (
          <p className="break-all font-mono text-[10px] text-muted">
            Backups: {outcome.backupDirectory}
          </p>
        ) : null}
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <p className="px-4 py-4 text-xs text-muted">
        This proposal was rejected. The repository was not modified.
      </p>
    );
  }

  if (status === "invalid") {
    return (
      <div className="space-y-2 px-4 py-4">
        <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          This proposal failed validation and cannot be applied. Nothing was written.
        </p>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => void submit(false)}
        >
          Discard proposal
        </button>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-4">
      {!applyEnabled ? (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
          Applying is disabled on this server. Set{" "}
          <span className="font-mono">COMMITPILOT_ALLOW_PATCH_APPLY=true</span> to enable it. Rejecting is
          always available.
        </p>
      ) : null}

      {!decision ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !applyEnabled}
            onClick={() => setDecision("approve")}
          >
            Approve and apply
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => setDecision("reject")}
          >
            Reject
          </button>
        </div>
      ) : decision === "approve" ? (
        <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <p>
            Apply this diff to the working tree? Files are backed up first, and the patch is re-validated
            before writing.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              {busy ? "Applying…" : "Yes, apply"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDecision(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <p>Reject this proposal? The repository will not be modified.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              {busy ? "Saving…" : "Yes, reject"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDecision(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div className="rounded border border-line bg-raised/50 px-3 py-2 text-[11px] text-muted">
          {outcome.changedFiles.length > 0 ? (
            <>
              <p className="text-ok">Applied to {outcome.changedFiles.length} file(s):</p>
              <ul className="mt-1 space-y-0.5 font-mono">
                {outcome.changedFiles.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>Proposal rejected. No files changed.</p>
          )}
          {outcome.backupDirectory ? (
            <p className="mt-1 break-all text-[10px]">Backups: {outcome.backupDirectory}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
