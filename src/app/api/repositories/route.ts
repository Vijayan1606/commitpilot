import path from "node:path";
import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { getWorkspaceRoot } from "@/server/config/settings";
import { createRepository, listRepositories, recordOperation } from "@/server/db/repositories";
import { resolveRepositoryPath } from "@/server/fs/pathGuard";
import { correlationId } from "@/server/observability/ids";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return jsonOk({
      repositories: listRepositories().map((repository) => ({
        ...repository,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const BodySchema = z.object({
  path: z.string().min(1).max(1000),
  name: z.string().min(1).max(100).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = BodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "Provide the absolute path of a Git repository.");
    }
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, parsed.data.path);
    const name = parsed.data.name?.trim() || path.basename(repositoryPath);
    const repository = createRepository(name, repositoryPath);
    recordOperation({
      repositoryId: repository.id,
      operationType: "register_repository",
      outcome: "success",
      correlationId: correlationId(),
      detail: repositoryPath,
    });
    return jsonOk({ repository }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
