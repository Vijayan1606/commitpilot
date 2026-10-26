import { execFile } from "node:child_process";
import path from "node:path";
import { AppError } from "../errors";

export interface GitResult {
  stdout: string;
  stderr: string;
}

const MAX_BUFFER = 16 * 1024 * 1024;

function gitEnv(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "SystemRoot", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL"];
  const env = {} as NodeJS.ProcessEnv;
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_PAGER = "cat";
  env.LC_ALL = "C";
  return env;
}

/**
 * Run a fixed-argument Git command. Callers must never interpolate user or
 * model text into the argument list; every call site builds arguments itself.
 */
export async function git(
  repositoryPath: string,
  args: string[],
  options: { timeoutMs?: number; allowFailure?: boolean } = {},
): Promise<GitResult> {
  try {
    const result = await new Promise<GitResult>((resolve, reject) => {
      execFile(
        "git",
        ["-C", repositoryPath, "-c", "core.quotepath=false", "-c", "safe.directory=*", ...args],
        {
          timeout: options.timeoutMs ?? 15_000,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          env: gitEnv(),
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error) {
            if (options.allowFailure) {
              resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
              return;
            }
            reject(
              new AppError(
                "REPOSITORY_INVALID",
                `Git command failed: ${String(stderr || error.message).trim().slice(0, 300)}`,
              ),
            );
            return;
          }
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        },
      );
    });
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("REPOSITORY_INVALID", "Git is not available or the repository is unreadable.");
  }
}

export async function isGitRepository(repositoryPath: string): Promise<boolean> {
  try {
    const { stdout } = await git(repositoryPath, ["rev-parse", "--is-inside-work-tree"], {
      allowFailure: true,
      timeoutMs: 8_000,
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export interface GitStatusSummary {
  branch: string | null;
  headCommit: string | null;
  isDirty: boolean;
  staged: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
  renamed: string[];
  clean: boolean;
}

export async function getGitStatus(repositoryPath: string): Promise<GitStatusSummary> {
  const [branchResult, headResult, statusResult] = await Promise.all([
    git(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true }),
    git(repositoryPath, ["rev-parse", "HEAD"], { allowFailure: true }),
    git(repositoryPath, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"], {
      allowFailure: true,
    }),
  ]);

  const branch = branchResult.stdout.trim();
  const headCommit = headResult.stdout.trim();
  const entries = statusResult.stdout.split("\0").filter((entry) => entry.length > 0);

  const staged: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const untracked: string[] = [];
  const renamed: string[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const indexStatus = code[0] ?? " ";
    const worktreeStatus = code[1] ?? " ";

    if (indexStatus === "R" || indexStatus === "C") {
      renamed.push(filePath);
      index += 1;
      continue;
    }
    if (indexStatus === "?") {
      untracked.push(filePath);
      continue;
    }
    if (indexStatus !== " " && indexStatus !== "?") staged.push(filePath);
    if (worktreeStatus === "D" || indexStatus === "D") deleted.push(filePath);
    else if (worktreeStatus !== " " && worktreeStatus !== "?") modified.push(filePath);
  }

  const isDirty = staged.length + modified.length + deleted.length + untracked.length + renamed.length > 0;
  return {
    branch: branch && branch !== "HEAD" ? branch : branch || null,
    headCommit: headCommit || null,
    isDirty,
    staged,
    modified,
    deleted,
    untracked,
    renamed,
    clean: !isDirty,
  };
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

export async function getRecentCommits(repositoryPath: string, limit = 10): Promise<GitCommit[]> {
  const { stdout } = await git(
    repositoryPath,
    [
      "log",
      `-n${Math.min(Math.max(limit, 1), 50)}`,
      "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
    ],
    { allowFailure: true },
  );
  return stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", shortHash = "", author = "", email = "", date = "", subject = ""] =
        record.split("\x1f");
      return { hash, shortHash, author, email, date, subject };
    })
    .filter((commit) => commit.hash.length > 0);
}

export async function listTrackedFiles(
  repositoryPath: string,
  limit: number,
): Promise<{ files: string[]; truncated: boolean; total: number }> {
  const { stdout } = await git(repositoryPath, ["ls-files", "-z"], {
    allowFailure: false,
    timeoutMs: 20_000,
  });
  const all = stdout.split("\0").filter(Boolean);
  const files = all.slice(0, limit);
  return { files, truncated: all.length > limit, total: all.length };
}

export type DiffMode = "unstaged" | "staged" | "both" | "commit_range";

const SAFE_RANGE = /^[A-Za-z0-9_.~^@/:-]{1,200}$/;

export function assertSafeCommitRange(range: string): string {
  const trimmed = range.trim();
  if (!SAFE_RANGE.test(trimmed) || trimmed.startsWith("-") || trimmed.includes("--")) {
    throw new AppError(
      "INVALID_ARGUMENTS",
      "The commit range is invalid. Use a range such as main..HEAD.",
    );
  }
  const dots = trimmed.split("..").length - 1;
  if (dots > 1) {
    throw new AppError("INVALID_ARGUMENTS", "The commit range is invalid.");
  }
  return trimmed;
}

function diffArgs(mode: DiffMode, range: string | null): string[] {
  const base = ["--no-color", "--no-ext-diff", "--unified=3"];
  switch (mode) {
    case "unstaged":
      return ["diff", ...base, "--"];
    case "staged":
      return ["diff", "--cached", ...base, "--"];
    case "both":
      return ["diff", "HEAD", ...base, "--"];
    case "commit_range": {
      if (!range) {
        throw new AppError("INVALID_ARGUMENTS", "A commit range is required for this diff mode.");
      }
      return ["diff", assertSafeCommitRange(range), ...base, "--"];
    }
  }
}

export interface DiffResult {
  mode: DiffMode;
  range: string | null;
  diff: string;
  truncated: boolean;
  bytes: number;
  changedFiles: string[];
  additions: number;
  deletions: number;
  empty: boolean;
}

export async function getDiff(
  repositoryPath: string,
  mode: DiffMode,
  range: string | null,
  maxBytes: number,
): Promise<DiffResult> {
  const args = diffArgs(mode, range);
  const [diffResult, numstatResult] = await Promise.all([
    git(repositoryPath, args, { allowFailure: true, timeoutMs: 30_000 }),
    git(
      repositoryPath,
      [...args.slice(0, -1), "--numstat"],
      { allowFailure: true, timeoutMs: 30_000 },
    ),
  ]);

  const raw = diffResult.stdout;
  const truncated = Buffer.byteLength(raw, "utf8") > maxBytes;
  const diff = truncated ? raw.slice(0, maxBytes) + "\n\n[diff truncated at size limit]" : raw;

  let additions = 0;
  let deletions = 0;
  const changedFiles: string[] = [];
  for (const line of numstatResult.stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [added, removed, file] = parts;
    if (added && added !== "-") additions += Number(added) || 0;
    if (removed && removed !== "-") deletions += Number(removed) || 0;
    if (file) changedFiles.push(file);
  }

  return {
    mode,
    range,
    diff,
    truncated,
    bytes: Buffer.byteLength(raw, "utf8"),
    changedFiles,
    additions,
    deletions,
    empty: raw.trim().length === 0,
  };
}

export async function getRepositoryRoot(repositoryPath: string): Promise<string> {
  const { stdout } = await git(repositoryPath, ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
  });
  const root = stdout.trim();
  return root ? path.resolve(root) : path.resolve(repositoryPath);
}

export interface ParsedDiffFile {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: number;
  header: string;
}

/** Parse a unified diff just far enough to summarize it safely. */
export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const oldPath = match?.[1] ?? null;
      const newPath = match?.[2] ?? null;
      current = {
        path: newPath ?? oldPath ?? "(unknown)",
        oldPath: oldPath && oldPath !== newPath ? oldPath : null,
        status: "modified",
        additions: 0,
        deletions: 0,
        hunks: 0,
        header: line,
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("@@")) current.hunks += 1;
    else if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }
  return files;
}
