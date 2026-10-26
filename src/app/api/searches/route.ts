import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { toolRegistry } from "@/server/tools";
import { AppError } from "@/server/errors";
import { correlationId } from "@/server/observability/ids";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repositoryId: z.string().min(3).max(200),
  query: z.string().min(2).max(300),
  summarize: z.boolean().optional().default(true),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = BodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "Provide a repository id and a search query.");
    }
    const result = await toolRegistry.dispatch("search_code", parsed.data, {
      surface: "web",
      correlationId: correlationId(),
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
