import { jsonError, jsonOk } from "@/server/http/handler";
import { getSettings, getWorkspaceRoot } from "@/server/config/settings";
import { getRepository } from "@/server/db/repositories";
import { listTrackedFiles } from "@/server/git/git";
import { buildTree, filterTrackedFiles } from "@/server/fs/readFile";
import { resolveRepositoryPath } from "@/server/fs/pathGuard";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const repository = getRepository(id);
    if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");

    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 1000), 1), 2000);

    const settings = getSettings();
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
    const tracked = await listTrackedFiles(repositoryPath, settings.limits.maxFiles);
    const filtered = filterTrackedFiles(tracked.files, {
      maxFiles: limit,
      userExclusions: settings.exclusions,
    });

    return jsonOk({
      files: filtered.files,
      tree: buildTree(filtered.files).slice(0, 4000),
      truncated: filtered.truncated || tracked.truncated,
      excluded: filtered.excluded,
      totalTracked: tracked.total,
    });
  } catch (error) {
    return jsonError(error);
  }
}
