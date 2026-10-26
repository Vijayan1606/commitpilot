import { jsonError, jsonOk } from "@/server/http/handler";
import { getSettings, getWorkspaceRoot } from "@/server/config/settings";
import { getConfig } from "@/server/config/env";
import { getRepository } from "@/server/db/repositories";
import { readRepositoryFile } from "@/server/fs/readFile";
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
    const filePath = url.searchParams.get("path");
    if (!filePath) throw new AppError("INVALID_ARGUMENTS", "A file path is required.");

    const settings = getSettings();
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
    const file = await readRepositoryFile(repositoryPath, filePath, {
      maxBytes: getConfig().limits.maxFileBytes,
      userExclusions: settings.exclusions,
      redact: false,
      maxLines: 5000,
    });

    return jsonOk({
      path: file.path,
      content: file.content,
      bytes: file.bytes,
      truncated: file.truncated,
      lineCount: file.lineCount,
      secretMatches: file.secretMatches.map((match) => ({
        rule: match.rule,
        line: match.line,
        preview: match.preview,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
