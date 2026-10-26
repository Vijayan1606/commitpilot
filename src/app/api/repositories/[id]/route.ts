import { jsonError, jsonOk } from "@/server/http/handler";
import { getSettings, getWorkspaceRoot } from "@/server/config/settings";
import { deleteRepository, getRepository, recordOperation, touchRepository } from "@/server/db/repositories";
import { inspectRepository } from "@/server/inspection/overview";
import { getGitStatus } from "@/server/git/git";
import { resolveRepositoryPath } from "@/server/fs/pathGuard";
import { correlationId, nowIso } from "@/server/observability/ids";
import { AppError } from "@/server/errors";
import { listCommands } from "@/server/commands/commands";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const repository = getRepository(id);
    if (!repository) {
      throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");
    }
    const settings = getSettings();
    const workspaceRoot = await getWorkspaceRoot();
    try {
      const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
      const [overview, status, commands] = await Promise.all([
        inspectRepository(repositoryPath, repository.name, {
          maxFiles: settings.limits.maxFiles,
          userExclusions: settings.exclusions,
        }),
        getGitStatus(repositoryPath),
        listCommands(repositoryPath),
      ]);
      touchRepository(repository.id, nowIso());
      return jsonOk({ repository, overview, status, commands, available: true, error: null });
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      return jsonOk({
        repository,
        overview: null,
        status: null,
        commands: [],
        available: false,
        error: appError
          ? { code: appError.code, message: appError.message }
          : { code: "INTERNAL_ERROR", message: "The repository could not be read." },
      });
    }
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
    const repository = getRepository(id);
    if (!repository) {
      throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");
    }
    deleteRepository(id);
    recordOperation({
      repositoryId: null,
      operationType: "remove_repository",
      outcome: "success",
      correlationId: correlationId(),
      detail: repository.name,
    });
    return jsonOk({ removed: true });
  } catch (error) {
    return jsonError(error);
  }
}
