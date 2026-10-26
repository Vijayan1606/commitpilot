import { jsonError, jsonOk } from "@/server/http/handler";
import { listReviews } from "@/server/db/analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repositoryId");
    const reviews = listReviews(100).filter(
      (review) => !repositoryId || review.repositoryId === repositoryId,
    );
    return jsonOk({ reviews });
  } catch (error) {
    return jsonError(error);
  }
}
