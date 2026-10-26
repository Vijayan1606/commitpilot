import { jsonError, jsonOk } from "@/server/http/handler";
import { getWorkspaceRoot } from "@/server/config/settings";
import { getConfig } from "@/server/config/env";
import { getRepository } from "@/server/db/repositories";
import { assertSafeCommitRange, getDiff, parseUnifiedDiff, type DiffMode } from "@/server/git/git";
import { resolveRepositoryPath } from "@/server/fs/pathGuard";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

const MODES: DiffMode[] = ["unstaged", "staged", "both", "commit_range"];

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const repository = getRepository(id);
    if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");

    const url = new URL(request.url);
    const modeParam = url.searchParams.get("mode") ?? "both";
    const mode = MODES.includes(modeParam as DiffMode) ? (modeParam as DiffMode) : null;
    if (!mode) throw new AppError("INVALID_ARGUMENTS", "Unsupported diff mode.");
    const rangeParam = url.searchParams.get("range");
    const range = rangeParam ? assertSafeCommitRange(rangeParam) : null;
    if (mode === "commit_range" && !range) {
      throw new AppError("INVALID_ARGUMENTS", "A commit range is required.");
    }

    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
    const diff = await getDiff(repositoryPath, mode, range, getConfig().limits.maxDiffBytes);

    return jsonOk({
      ...diff,
      files: parseUnifiedDiff(diff.diff),
    });
  } catch (error) {
    return jsonError(error);
  }
}
