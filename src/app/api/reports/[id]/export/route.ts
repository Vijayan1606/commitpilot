import { getReport } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { sanitizeFilename } from "@/server/reports/report";
import { AppError } from "@/server/errors";
import { jsonError } from "@/server/http/handler";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "json") {
      throw new AppError("INVALID_ARGUMENTS", "Supported export formats are md and json.");
    }
    const report = getReport(id);
    if (!report) throw new AppError("REPORT_NOT_FOUND", "That report does not exist.");
    const repository = getRepository(report.repositoryId);
    const base = sanitizeFilename(
      `${repository?.name ?? "repository"}-${report.reportType}-${report.createdAt.slice(0, 10)}`,
    );
    const body = format === "md" ? report.markdown : report.json;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.${format}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
