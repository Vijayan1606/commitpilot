"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReportDeleteButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? "The report could not be deleted.");
        return;
      }
      router.push("/reports");
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
        Delete
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-danger">Delete this report?</span>
      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>
        {busy ? "…" : "Delete"}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      {error ? <span className="text-[10px] text-danger">{error}</span> : null}
    </div>
  );
}
