"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  validating: "Validating repository path",
  inspecting: "Inspecting repository",
  collecting_evidence: "Collecting bounded evidence",
  calling_model: "Calling the open model",
  verifying: "Verifying findings",
  saving: "Saving report",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

interface JobSnapshot {
  id: string;
  status: string;
  stage: string | null;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export function JobMonitor({ jobId, initial }: { jobId: string; initial: JobSnapshot }) {
  const router = useRouter();
  const [job, setJob] = useState<JobSnapshot>(initial);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/api/analyses/${jobId}/cancel`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { job?: JobSnapshot };
        if (!active || !payload.job) return;
        setJob(payload.job);
        if (["completed", "failed", "cancelled"].includes(payload.job.status)) {
          router.refresh();
          return;
        }
        timer = setTimeout(poll, 1500);
      } catch {
        timer = setTimeout(poll, 3000);
      }
    }

    timer = setTimeout(poll, 1200);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, router]);

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const response = await fetch(`/api/analyses/${jobId}/cancel`, { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setCancelError(payload.error?.message ?? "The run could not be cancelled.");
        return;
      }
      router.refresh();
    } catch {
      setCancelError("The cancel request failed.");
    } finally {
      setCancelling(false);
    }
  }

  const terminal = ["completed", "failed", "cancelled"].includes(job.status);
  const progress = Math.max(0, Math.min(100, job.progress));

  return (
    <div className="space-y-3 px-4 py-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{STAGE_LABEL[job.stage ?? job.status] ?? job.stage ?? job.status}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {terminal ? "This run has finished." : "This page updates automatically."}
          </p>
        </div>
        {!terminal ? (
          <button type="button" className="btn btn-sm" onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        ) : null}
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
        <div
          className={`h-1.5 rounded-full ${job.status === "failed" ? "bg-danger" : "bg-citron"} transition-all`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {job.errorMessage ? (
        <p className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {job.errorCode ? `${job.errorCode}: ` : ""}
          {job.errorMessage}
        </p>
      ) : null}
      {cancelError ? <p className="text-xs text-danger">{cancelError}</p> : null}
    </div>
  );
}