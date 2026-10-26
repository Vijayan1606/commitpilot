import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "../errors";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function isContained(parent: string, child: string): boolean {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);
  if (relative === "") return true;
  if (relative.startsWith("..")) return false;
  if (path.isAbsolute(relative)) return false;
  // Windows paths are case-insensitive; path.relative already handles the
  // drive letter, but explicit casing differences are still possible.
  if (process.platform === "win32") {
    return !path.relative(parentResolved.toLowerCase(), childResolved.toLowerCase()).startsWith("..");
  }
  return true;
}

function assertNoNullBytes(value: string): void {
  if (value.includes("\0")) {
    throw new AppError("PATH_REJECTED", "The path contains an invalid character.");
  }
}

export function assertNotDangerousLocation(target: string): void {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new AppError("PATH_REJECTED", "A filesystem root cannot be used as a workspace.");
  }
  if (resolved === path.resolve(os.homedir())) {
    throw new AppError("PATH_REJECTED", "The home directory itself cannot be used as a workspace.");
  }
  if (process.platform === "win32") {
    const lower = resolved.toLowerCase();
    const forbiddenPrefixes = [
      process.env.SystemRoot?.toLowerCase(),
      process.env.ProgramFiles?.toLowerCase(),
      process.env["ProgramFiles(x86)"]?.toLowerCase(),
      process.env.ProgramData?.toLowerCase(),
      "c:\\$recycle.bin",
      "c:\\system volume information",
    ].filter((entry): entry is string => Boolean(entry));
    if (forbiddenPrefixes.some((prefix) => lower === prefix || lower.startsWith(prefix + path.sep))) {
      throw new AppError("PATH_REJECTED", "System directories cannot be used as a workspace.");
    }
  }
}

/** Resolve a configured workspace root, following symlinks, and require a directory. */
export async function resolveWorkspaceRoot(root: string): Promise<string> {
  assertNoNullBytes(root);
  if (!path.isAbsolute(root)) {
    throw new AppError("PATH_REJECTED", "The workspace root must be an absolute path.");
  }
  assertNotDangerousLocation(root);
  let real: string;
  try {
    real = await fs.realpath(root);
  } catch {
    throw new AppError(
      "PATH_REJECTED",
      `The workspace root does not exist: ${root}. Create it or update COMMITPILOT_WORKSPACE_ROOT.`,
    );
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new AppError("PATH_REJECTED", "The workspace root must be a directory.");
  }
  return real;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a repository path. Accepts an absolute path or a path relative to
 * the workspace root. Symlinks are resolved before containment is enforced, so
 * a link cannot be used to escape the workspace.
 */
export async function resolveRepositoryPath(
  workspaceRoot: string,
  candidate: string,
): Promise<string> {
  assertNoNullBytes(candidate);
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new AppError("INVALID_ARGUMENTS", "A repository path is required.");
  }
  const realRoot = await resolveWorkspaceRoot(workspaceRoot);
  const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(realRoot, trimmed);

  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch {
    throw new AppError("REPOSITORY_INVALID", `The repository path does not exist: ${trimmed}`);
  }

  if (!isContained(realRoot, real)) {
    throw new AppError(
      "PATH_OUTSIDE_WORKSPACE",
      "The repository must live inside the configured workspace root.",
    );
  }
  assertNotDangerousLocation(real);

  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new AppError("REPOSITORY_INVALID", "The repository path must be a directory.");
  }

  const gitEntry = path.join(real, ".git");
  if (!(await exists(gitEntry))) {
    throw new AppError(
      "REPOSITORY_INVALID",
      "The selected directory is not a Git repository (no .git entry found).",
    );
  }

  return real;
}

/**
 * Resolve a repository-relative file path safely. Rejects absolute paths,
 * traversal, Windows device names, and symlinks that resolve outside the repo.
 */
export async function resolveRepoFile(
  repositoryRoot: string,
  relativePath: string,
  options: { mustExist?: boolean } = {},
): Promise<string> {
  assertNoNullBytes(relativePath);
  const normalizedInput = relativePath.replace(/\\/g, "/").trim();
  if (!normalizedInput) {
    throw new AppError("INVALID_ARGUMENTS", "A file path is required.");
  }
  if (normalizedInput.startsWith("/") || /^[a-zA-Z]:/.test(normalizedInput)) {
    throw new AppError("PATH_REJECTED", "Absolute file paths are not accepted.");
  }
  const segments = normalizedInput.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new AppError("PATH_REJECTED", "Path traversal is not allowed.");
  }
  if (segments.some((segment) => WINDOWS_RESERVED.test(segment))) {
    throw new AppError("PATH_REJECTED", "Reserved device names are not allowed.");
  }

  const realRoot = await fs.realpath(repositoryRoot);
  const target = path.resolve(realRoot, ...segments);
  if (!isContained(realRoot, target)) {
    throw new AppError("PATH_OUTSIDE_WORKSPACE", "The file is outside the repository.");
  }

  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    if (options.mustExist === false) return target;
    throw new AppError("FILE_NOT_FOUND", `The file does not exist: ${normalizedInput}`);
  }

  if (!isContained(realRoot, real)) {
    throw new AppError(
      "PATH_OUTSIDE_WORKSPACE",
      "The file resolves outside the repository and was rejected.",
    );
  }
  return real;
}

export function toRepoRelative(repositoryRoot: string, absolute: string): string {
  return path.relative(path.resolve(repositoryRoot), path.resolve(absolute)).split(path.sep).join("/");
}
