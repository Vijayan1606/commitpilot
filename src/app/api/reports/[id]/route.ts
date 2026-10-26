import { jsonError, jsonOk } from "@/server/http/handler";
import { deleteReport, getReport } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const report = getReport(id);
    if (!report) throw new AppError("REPORT_NOT_FOUND", "That report does not exist.");
    return jsonOk({ report, repository: getRepository(report.repositoryId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!deleteReport(id)) {
      throw new AppError("REPORT_NOT_FOUND", "That report does not exist.");
    }
    return jsonOk({ removed: true });
  } catch (error) {
    return jsonError(error);
  }
}
