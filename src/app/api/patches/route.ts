import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { listPatches, getPatch } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { proposePatchWorkflow } from "@/server/patches/workflow";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repositoryId: z.string().min(3).max(200),
  request: z.string().min(5).max(2000),
  filePaths: z.array(z.string().min(1).max(400)).max(5).optional(),
  findingId: z.string().min(3).max(200).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repositoryId");
    const patchId = url.searchParams.get("id");
    if (patchId) {
      const patch = getPatch(patchId);
      if (!patch) throw new AppError("NOT_FOUND", "That patch does not exist.");
      return jsonOk({ patch, repository: getRepository(patch.repositoryId) });
    }
    return jsonOk({ patches: listPatches(repositoryId ?? undefined, 50) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = BodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "Describe the patch you want to propose.");
    }
    const patch = await proposePatchWorkflow(parsed.data);
    return jsonOk({ patch, repository: getRepository(patch.repositoryId) }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
