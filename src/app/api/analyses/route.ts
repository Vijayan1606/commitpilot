import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { startAnalysis } from "@/server/analysis/orchestrator";
import { listJobs, listJobsForRepository } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repositoryId: z.string().min(3).max(200),
  type: z.enum(["repository_analysis", "code_review", "test_gaps", "security_review"]),
  question: z.string().min(3).max(2000).optional(),
  mode: z.enum(["unstaged", "staged", "both", "commit_range"]).optional(),
  range: z.string().max(200).nullable().optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repositoryId");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30), 1), 100);
    const jobs = repositoryId ? listJobsForRepository(repositoryId, limit) : listJobs(limit);
    return jsonOk({ jobs });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = BodySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "Provide a repository id and a supported analysis type.");
    }
    if (!getRepository(parsed.data.repositoryId)) {
      throw new AppError("REPOSITORY_NOT_FOUND", "The repository is not registered.");
    }
    const job = await startAnalysis({
      repositoryId: parsed.data.repositoryId,
      type: parsed.data.type,
      question: parsed.data.question,
      diffMode: parsed.data.mode,
      range: parsed.data.range ?? null,
    });
    return jsonOk({ job }, 202);
  } catch (error) {
    return jsonError(error);
  }
}
