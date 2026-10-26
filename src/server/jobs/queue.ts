import { logger } from "../observability/logger";
import { AppError, toAppError } from "../errors";
import { getJob, updateJob } from "../db/analysis";
import { recordOperation } from "../db/repositories";

const active = new Set<string>();

/**
 * In-process job runner. Jobs are persisted in SQLite, so their status survives
 * a restart; `reapStaleJobs` marks interrupted work as failed instead of
 * leaving it running forever. This is deliberately not a distributed queue.
 */
export function scheduleJob(jobId: string, run: () => Promise<void>): void {
  if (active.has(jobId)) return;
  active.add(jobId);
  void run()
    .catch((error: unknown) => {
      const appError = toAppError(error);
      const job = getJob(jobId);
      updateJob(jobId, {
        status: "failed",
        stage: "failed",
        errorCode: appError.code,
        errorMessage: appError.message,
        completedAt: new Date().toISOString(),
      });
      if (job) {
        recordOperation({
          repositoryId: job.repositoryId,
          operationType: job.analysisType,
          outcome: "failure",
          correlationId: job.correlationId,
          detail: appError.code,
        });
      }
      logger.error("job_failed", {
        jobId,
        code: appError.code,
        message: appError.message,
      });
    })
    .finally(() => {
      active.delete(jobId);
    });
}

export function isJobActive(jobId: string): boolean {
  return active.has(jobId);
}

export function activeJobCount(): number {
  return active.size;
}

export function cancelJob(jobId: string): void {
  const job = getJob(jobId);
  if (!job) throw new AppError("JOB_NOT_FOUND", "That analysis job does not exist.");
  if (job.status === "queued" || job.status === "running") {
    updateJob(jobId, {
      status: "cancelled",
      stage: "cancelled",
      completedAt: new Date().toISOString(),
    });
  }
}
