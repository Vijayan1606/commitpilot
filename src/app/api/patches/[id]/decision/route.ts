import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { decidePatch } from "@/server/patches/workflow";
import { getRepository } from "@/server/db/repositories";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  approve: z.boolean(),
  confirm: z.literal(true),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const parsed = BodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError(
        "INVALID_ARGUMENTS",
        "Confirm the decision explicitly with confirm: true.",
      );
    }
    const result = await decidePatch({ patchId: id, approve: parsed.data.approve });
    return jsonOk({
      ...result,
      repository: getRepository(result.patch.repositoryId),
    });
  } catch (error) {
    return jsonError(error);
  }
}
