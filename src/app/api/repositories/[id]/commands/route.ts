import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { getWorkspaceRoot } from "@/server/config/settings";
import { getRepository, recordOperation } from "@/server/db/repositories";
import { listCommands, runCommand } from "@/server/commands/commands";
import { resolveRepositoryPath } from "@/server/fs/pathGuard";
import { correlationId } from "@/server/observability/ids";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const repository = getRepository(id);
    if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
    return jsonOk({ commands: await listCommands(repositoryPath) });
  } catch (error) {
    return jsonError(error);
  }
}

const BodySchema = z.object({
  commandId: z.string().min(3).max(80),
  confirm: z.literal(true),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const repository = getRepository(id);
    if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");
    const parsed = BodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "Choose a command and confirm the run explicitly.");
    }
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
    const result = await runCommand(repositoryPath, parsed.data.commandId, { confirm: true });
    recordOperation({
      repositoryId: repository.id,
      operationType: "run_command",
      outcome: result.exitCode === 0 ? "success" : "failure",
      correlationId: correlationId(),
      detail: `${result.commandId} exit=${result.exitCode ?? "none"}${result.timedOut ? " timeout" : ""}`,
    });
    return jsonOk({ result });
  } catch (error) {
    return jsonError(error);
  }
}
