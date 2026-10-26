import { jsonError, jsonOk } from "@/server/http/handler";
import { getJob, getReportByJobId, getReviewByJobId, listFindings } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) throw new AppError("JOB_NOT_FOUND", "That analysis job does not exist.");
    const repository = getRepository(job.repositoryId);
    const report = getReportByJobId(job.id);
    const review = getReviewByJobId(job.id);
    return jsonOk({
      job,
      repository,
      findings: listFindings(job.id),
      report: report ? { id: report.id, title: report.title, type: report.reportType } : null,
      review,
    });
  } catch (error) {
    return jsonError(error);
  }
}
