"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRepositoryButton({ repositoryId, name }: { repositoryId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/repositories/${repositoryId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? "The repository could not be removed.");
        return;
      }
      router.push("/repositories");
      router.refresh();
    } catch {
      setError("The request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
        Remove
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-2 py-1">
      <span className="text-[11px] text-danger">Unregister {name}? Files stay untouched.</span>
      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>
        {busy ? "…" : "Remove"}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      {error ? <span className="text-[10px] text-danger">{error}</span> : null}
    </div>
  );
}
