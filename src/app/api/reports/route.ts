import { jsonError, jsonOk } from "@/server/http/handler";
import { listReports, listReportsForRepository } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repositoryId");
    const reports = repositoryId ? listReportsForRepository(repositoryId, 100) : listReports(100);
    return jsonOk({
      reports: reports.map((report) => ({
        id: report.id,
        repositoryId: report.repositoryId,
        repositoryName: getRepository(report.repositoryId)?.name ?? "unknown",
        jobId: report.jobId,
        reportType: report.reportType,
        title: report.title,
        createdAt: report.createdAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
