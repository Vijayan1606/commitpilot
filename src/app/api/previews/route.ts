import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { getSettings, getWorkspaceRoot, resolveModelConfig } from "@/server/config/settings";
import { getRepository } from "@/server/db/repositories";
import { gatherEvidence, factsFromOverview } from "@/server/analysis/evidence";
import { inspectRepository } from "@/server/inspection/overview";
import { resolveRepositoryPath } from "@/server/fs/pathGuard";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repositoryId: z.string().min(3).max(200),
  question: z.string().min(3).max(2000).optional(),
  type: z.enum(["repository_analysis", "code_review", "test_gaps", "security_review"]).optional(),
});

const DEFAULT_QUESTION: Record<string, string> = {
  repository_analysis: "Analyse this repository and explain its architecture.",
  code_review: "Review the current changes.",
  test_gaps: "Which modules have no tests?",
  security_review: "Look for security weaknesses.",
};

/**
 * Show exactly what would be sent to the model for a given request: which
 * files, how large, how many redactions. No model call, no persistence.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = BodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "Provide a repository id and a question.");
    }
    const repository = getRepository(parsed.data.repositoryId);
    if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");

    const settings = getSettings();
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
    const question = parsed.data.question ?? DEFAULT_QUESTION[parsed.data.type ?? "repository_analysis"] ?? "Analyse this repository.";
    const mode =
      parsed.data.type === "test_gaps"
        ? "test_gaps"
        : parsed.data.type === "security_review"
          ? "security"
          : "repository";

    const overview = await inspectRepository(repositoryPath, repository.name, {
      maxFiles: settings.limits.maxFiles,
      userExclusions: settings.exclusions,
    });
    factsFromOverview(overview);

    const evidence = await gatherEvidence(repositoryPath, {
      question,
      mode,
      maxFiles: settings.limits.maxFiles,
      maxFileBytes: 262_144,
      maxContextChars: settings.limits.maxContextChars,
      userExclusions: settings.exclusions,
    });

    const model = resolveModelConfig();
    const totalChars = evidence.files.reduce((sum, file) => sum + file.content.length, 0);

    return jsonOk({
      repository: { id: repository.id, name: repository.name },
      question,
      mode,
      model: {
        configured: model.configured,
        provider: model.providerLabel,
        name: model.model,
        hosted: model.hosted,
        privacyBlocked: model.privacyBlocked,
      },
      files: evidence.files.map((file) => ({
        path: file.path,
        bytes: file.bytes,
        chars: file.content.length,
        truncated: file.truncated,
        redactions: file.redactions,
      })),
      totalChars,
      omitted: evidence.omitted,
      truncated: evidence.truncated,
      note: "This is the bounded, redacted evidence set. Excluded paths never appear here. Sending it to a hosted model is a privacy decision; use a loopback endpoint to keep code on this machine.",
    });
  } catch (error) {
    return jsonError(error);
  }
}
