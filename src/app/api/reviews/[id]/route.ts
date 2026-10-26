import { jsonError, jsonOk } from "@/server/http/handler";
import { getJob, getReportByJobId, getReview, listFindings } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const review = getReview(id);
    if (!review) throw new AppError("NOT_FOUND", "That review does not exist.");
    const job = getJob(review.jobId);
    const report = job ? getReportByJobId(job.id) : null;
    return jsonOk({
      review,
      job,
      repository: getRepository(review.repositoryId),
      findings: job ? listFindings(job.id) : [],
      report: report ? { id: report.id, title: report.title } : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
