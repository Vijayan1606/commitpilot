import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config/env";
import { AppError } from "../errors";
import { git, listTrackedFiles } from "../git/git";
import { evaluatePath } from "../fs/exclusions";
import { resolveRepoFile } from "../fs/pathGuard";
import type { PatchValidation } from "@/shared/types";
import { newId, nowIso } from "../observability/ids";

const MAX_PATCH_BYTES = 200_000;

function reject(message: string): never {
  throw new AppError("PATCH_INVALID", message);
}

export function extractPatchPaths(diff: string): string[] {
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      if (!match) reject("The diff contains a malformed file header.");
      const [, oldPath, newPath] = match;
      if (!oldPath || !newPath) reject("The diff contains a malformed file header.");
      if (oldPath !== newPath) {
        reject("Renames are not allowed in a proposed patch.");
      }
      paths.add(oldPath);
    } else if (line.startsWith("+++ b/")) {
      paths.add(line.slice("+++ b/".length).trim());
    } else if (line.startsWith("--- a/")) {
      paths.add(line.slice("--- a/".length).trim());
    }
  }
  return [...paths];
}

export function normalizeDiff(diff: string): string {
  return diff.replace(/\r\n/g, "\n").replace(/\uFEFF/g, "").replace(/\n*$/, "\n");
}

export function assertPatchShape(diff: string): string[] {
  if (!diff.trim()) reject("The proposed patch is empty.");
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) reject("The proposed patch is too large.");
  if (diff.includes("\r")) reject("The proposed patch must use LF line endings.");
  if (!/^diff --git /m.test(diff) || !/^--- /m.test(diff) || !/^\+\+\+ /m.test(diff)) {
    reject("The proposed patch is not a unified diff with git headers.");
  }
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ") && !line.startsWith("--- a/")) {
      reject("Every removed-file header must use the a/ prefix.");
    }
    if (line.startsWith("+++ ") && !line.startsWith("+++ b/")) {
      reject("Every added-file header must use the b/ prefix.");
    }
  }
  if (diff.includes("--- /dev/null") || diff.includes("+++ /dev/null")) {
    reject("Creating or deleting files is not allowed in a proposed patch.");
  }
  const forbidden = [
    "GIT binary patch",
    "Binary files",
    "new file mode",
    "deleted file mode",
    "rename from",
    "rename to",
    "old mode",
    "new mode",
    "similarity index",
    "copy from",
  ];
  for (const marker of forbidden) {
    if (diff.includes(marker)) reject(`The proposed patch contains a disallowed change type: ${marker}.`);
  }

  const paths = extractPatchPaths(diff);
  if (paths.length === 0) reject("The proposed patch does not touch any file.");
  if (paths.length > 20) reject("The proposed patch touches too many files.");

  for (const filePath of paths) {
    if (!filePath || filePath.length > 400) reject("The proposed patch contains an invalid file path.");
    if (filePath.startsWith("/") || /^[a-zA-Z]:/.test(filePath)) {
      reject("The proposed patch contains an absolute file path.");
    }
    if (filePath.includes("..") || filePath.includes("\\") || filePath.includes("\0")) {
      reject("The proposed patch contains an unsafe file path.");
    }
  }
  return paths;
}

async function writeTempPatch(diff: string): Promise<string> {
  const { dataDir } = getConfig();
  const dir = path.join(dataDir, "tmp");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${newId("patch")}.diff`);
  await fs.writeFile(file, diff, { encoding: "utf8", mode: 0o600 });
  return file;
}

export async function validatePatch(
  repositoryRoot: string,
  diff: string,
  options: { maxFiles: number; userExclusions: string[] },
): Promise<PatchValidation> {
  const checkedAt = nowIso();
  const errors: string[] = [];
  let filesTouched: string[] = [];
  let appliesCleanly = false;
  let diffStat: string | null = null;
  const normalized = normalizeDiff(diff);

  try {
    filesTouched = assertPatchShape(normalized);
    const tracked = await listTrackedFiles(repositoryRoot, options.maxFiles * 2);
    const trackedSet = new Set(tracked.files.map((file) => file.replace(/\\/g, "/")));

    for (const filePath of filesTouched) {
      if (evaluatePath(filePath, options.userExclusions).excluded) {
        errors.push(`The patch touches an excluded path: ${filePath}`);
      }
      if (!trackedSet.has(filePath)) {
        errors.push(`The patch touches a file that is not tracked in the repository: ${filePath}`);
      }
    }

    if (errors.length === 0) {
      const temp = await writeTempPatch(normalized);
      try {
        const check = await git(repositoryRoot, ["apply", "--check", "--whitespace=nowarn", temp], {
          allowFailure: true,
          timeoutMs: 20_000,
        });
        appliesCleanly = check.stderr.trim().length === 0;
        if (!appliesCleanly) {
          errors.push(`git apply --check failed: ${check.stderr.trim().slice(0, 400)}`);
        }
        const stat = await git(repositoryRoot, ["apply", "--stat", temp], {
          allowFailure: true,
          timeoutMs: 20_000,
        });
        diffStat = stat.stdout.trim().slice(0, 2000) || null;
      } finally {
        await fs.unlink(temp).catch(() => undefined);
      }
    }
  } catch (error) {
    errors.push(error instanceof AppError ? error.message : "The patch could not be validated.");
  }

  return {
    ok: errors.length === 0 && appliesCleanly,
    checkedAt,
    errors,
    filesTouched,
    appliesCleanly,
    diffStat,
  };
}

export interface ApplyResult {
  validation: PatchValidation;
  backupDirectory: string | null;
  changedFiles: string[];
}

/**
 * Apply a validated patch. Every touched file is copied to a backup directory
 * first. `git apply` is atomic: a failed apply leaves the working tree alone.
 */
export async function applyPatch(
  repositoryRoot: string,
  patchId: string,
  diff: string,
  options: { maxFiles: number; userExclusions: string[] },
): Promise<ApplyResult> {
  const config = getConfig();
  if (!config.allowPatchApply) {
    throw new AppError(
      "PATCH_APPLY_DISABLED",
      "Patch application is disabled. Set COMMITPILOT_ALLOW_PATCH_APPLY=true to enable it.",
    );
  }

  const validation = await validatePatch(repositoryRoot, diff, options);
  if (!validation.ok) {
    throw new AppError("PATCH_INVALID", `The patch did not pass validation: ${validation.errors.join("; ")}`);
  }

  const backupRoot = path.join(config.dataDir, "backups", patchId.replace(/[^a-zA-Z0-9_-]/g, ""));
  await fs.mkdir(backupRoot, { recursive: true });
  for (const filePath of validation.filesTouched) {
    const absolute = await resolveRepoFile(repositoryRoot, filePath);
    const target = path.join(backupRoot, ...filePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(absolute, target);
  }

  const temp = await writeTempPatch(normalizeDiff(diff));
  try {
    const result = await git(repositoryRoot, ["apply", "--whitespace=nowarn", temp], {
      allowFailure: true,
      timeoutMs: 20_000,
    });
    if (result.stderr.trim().length > 0) {
      throw new AppError("PATCH_INVALID", `The patch failed to apply: ${result.stderr.trim().slice(0, 300)}`);
    }
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }

  const status = await git(repositoryRoot, ["status", "--porcelain", "--", ...validation.filesTouched], {
    allowFailure: true,
  });
  const changedFiles = status.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

  return { validation, backupDirectory: backupRoot, changedFiles };
}
