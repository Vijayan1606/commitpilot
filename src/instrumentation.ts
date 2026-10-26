export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./server/db/client");
  const { reapStaleJobs } = await import("./server/db/analysis");
  getDb();
  const reaped = reapStaleJobs();
  if (reaped > 0) {
    const { logger } = await import("./server/observability/logger");
    logger.warn("stale_jobs_reaped", { count: reaped });
  }
}
