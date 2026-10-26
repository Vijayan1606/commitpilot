import { getConfig } from "../config/env";
import { getSettings, getWorkspaceRoot } from "../config/settings";
import { createPatch, getFindingById, getJob, getPatch, updatePatchStatus } from "../db/analysis";
import { getRepository, recordOperation } from "../db/repositories";
import { AppError } from "../errors";
import { evaluatePath } from "../fs/exclusions";
import { resolveRepositoryPath, resolveRepoFile } from "../fs/pathGuard";
import { listTrackedFiles } from "../git/git";
import { readRepositoryFile } from "../fs/readFile";
import { createModelProvider } from "../models/provider";
import type { EvidenceFile } from "../models/types";
import { correlationId } from "../observability/ids";
import { logger } from "../observability/logger";
import { applyPatch, validatePatch } from "./patch";
import { gatherEvidence, factsFromOverview } from "../analysis/evidence";
import { inspectRepository } from "../inspection/overview";
import type { PatchRecord } from "@/shared/types";

export interface ProposePatchInput {
  repositoryId: string;
  request: string;
  filePaths?: string[];
  findingId?: string;
}

export async function proposePatchWorkflow(input: ProposePatchInput): Promise<PatchRecord> {
  const repository = getRepository(input.repositoryId);
  if (!repository) {
    throw new AppError("REPOSITORY_NOT_FOUND", "The selected repository is not registered.");
  }
  const request = input.request.trim();
  if (request.length < 5 || request.length > 2000) {
    throw new AppError("INVALID_ARGUMENTS", "Describe the patch you want in 5–2000 characters.");
  }

  const settings = getSettings();
  const workspaceRoot = await getWorkspaceRoot();
  const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);

  const tracked = await listTrackedFiles(repositoryPath, settings.limits.maxFiles * 2);
  const trackedSet = new Set(tracked.files.map((file) => file.replace(/\\/g, "/")));

  const targetPaths = new Set<string>();

  if (input.findingId) {
    const finding = getFindingById(input.findingId);
    if (!finding) throw new AppError("NOT_FOUND", "That finding does not exist.");
    const findingJob = getJob(finding.analysisJobId);
    if (!findingJob || findingJob.repositoryId !== repository.id) {
      throw new AppError("NOT_FOUND", "That finding belongs to a different repository.");
    }
    if (finding.filePath) targetPaths.add(finding.filePath);
  }

  for (const candidate of input.filePaths ?? []) {
    const normalized = candidate.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!trackedSet.has(normalized)) {
      throw new AppError("INVALID_ARGUMENTS", `Not a tracked file in this repository: ${normalized}`);
    }
    if (evaluatePath(normalized, settings.exclusions).excluded) {
      throw new AppError("FILE_EXCLUDED", `That path is excluded: ${normalized}`);
    }
    targetPaths.add(normalized);
  }

  if (targetPaths.size === 0) {
    const evidence = await gatherEvidence(repositoryPath, {
      question: request,
      mode: "repository",
      maxFiles: settings.limits.maxFiles,
      maxFileBytes: 262_144,
      maxContextChars: settings.limits.maxContextChars,
      userExclusions: settings.exclusions,
    });
    for (const file of evidence.files.slice(0, 3)) targetPaths.add(file.path);
  }

  if (targetPaths.size === 0) {
    throw new AppError(
      "INVALID_ARGUMENTS",
      "No suitable target files were found. Pass filePaths explicitly.",
    );
  }

  const targetFiles: EvidenceFile[] = [];
  for (const filePath of [...targetPaths].slice(0, 5)) {
    await resolveRepoFile(repositoryPath, filePath);
    const file = await readRepositoryFile(repositoryPath, filePath, {
      maxBytes: 262_144,
      userExclusions: settings.exclusions,
      redact: true,
      maxLines: 1200,
    });
    targetFiles.push({
      path: filePath,
      content: file.content,
      bytes: file.bytes,
      truncated: file.truncated,
      redactions: file.secretMatches.length,
    });
  }

  const overview = await inspectRepository(repositoryPath, repository.name, {
    maxFiles: settings.limits.maxFiles,
    userExclusions: settings.exclusions,
  });
  const provider = createModelProvider(null);
  const proposal = await provider.proposePatch({
    request,
    facts: factsFromOverview(overview),
    targetFiles,
    staticFindings: [],
  });

  const validation = await validatePatch(repositoryPath, proposal.unifiedDiff, {
    maxFiles: settings.limits.maxFiles,
    userExclusions: settings.exclusions,
  });

  const patch = createPatch({
    repositoryId: repository.id,
    jobId: null,
    title: proposal.title,
    rationale: proposal.rationale,
    patchText: proposal.unifiedDiff,
    files: validation.filesTouched,
    status: validation.ok ? "proposed" : "invalid",
    validation,
  });

  recordOperation({
    repositoryId: repository.id,
    operationType: "propose_patch",
    outcome: validation.ok ? "success" : "rejected",
    correlationId: correlationId(),
    detail: validation.ok ? "patch validated" : validation.errors.join("; ").slice(0, 300),
  });
  logger.info("patch_proposed", {
    patchId: patch.id,
    repositoryId: repository.id,
    files: validation.filesTouched.length,
    ok: validation.ok,
  });

  return patch;
}

export interface PatchDecisionResult {
  patch: PatchRecord;
  changedFiles: string[];
  backupDirectory: string | null;
}

export async function decidePatch(input: {
  patchId: string;
  approve: boolean;
}): Promise<PatchDecisionResult> {
  const patch = getPatch(input.patchId);
  if (!patch) throw new AppError("NOT_FOUND", "That patch proposal does not exist.");
  if (patch.status === "applied") {
    throw new AppError("PATCH_REJECTED", "This patch has already been applied.");
  }
  if (patch.status === "rejected") {
    throw new AppError("PATCH_REJECTED", "This patch was already rejected.");
  }

  const repository = getRepository(patch.repositoryId);
  if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The repository is no longer registered.");

  const settings = getSettings();
  const workspaceRoot = await getWorkspaceRoot();
  const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);

  if (!input.approve) {
    updatePatchStatus(patch.id, "rejected");
    recordOperation({
      repositoryId: repository.id,
      operationType: "reject_patch",
      outcome: "success",
      correlationId: correlationId(),
      detail: `patch ${patch.id}`,
    });
    return {
      patch: { ...patch, status: "rejected" },
      changedFiles: [],
      backupDirectory: null,
    };
  }

  if (!getConfig().allowPatchApply) {
    throw new AppError(
      "PATCH_APPLY_DISABLED",
      "Patch application is disabled. Set COMMITPILOT_ALLOW_PATCH_APPLY=true to enable it.",
    );
  }

  const applied = await applyPatch(repositoryPath, patch.id, patch.patchText, {
    maxFiles: settings.limits.maxFiles,
    userExclusions: settings.exclusions,
  });
  updatePatchStatus(patch.id, "applied", applied.validation);
  recordOperation({
    repositoryId: repository.id,
    operationType: "apply_patch",
    outcome: "success",
    correlationId: correlationId(),
    detail: `patch ${patch.id}; ${applied.changedFiles.length} files changed`,
  });
  logger.info("patch_applied", {
    patchId: patch.id,
    repositoryId: repository.id,
    changedFiles: applied.changedFiles.length,
  });

  return {
    patch: { ...patch, status: "applied", validation: applied.validation },
    changedFiles: applied.changedFiles,
    backupDirectory: applied.backupDirectory,
  };
}
