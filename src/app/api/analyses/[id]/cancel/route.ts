import { jsonError, jsonOk } from "@/server/http/handler";
import { cancelJob } from "@/server/jobs/queue";
import { getJob } from "@/server/db/analysis";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    cancelJob(id);
    return jsonOk({ job: getJob(id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job) throw new AppError("JOB_NOT_FOUND", "That analysis job does not exist.");
    return jsonOk({ job });
  } catch (error) {
    return jsonError(error);
  }
}
