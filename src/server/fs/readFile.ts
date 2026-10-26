import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors";
import { assertPathAllowed, evaluatePath, isBinaryExtension, looksBinaryContent } from "./exclusions";
import { resolveRepoFile } from "./pathGuard";
import { redactSecrets, scanForSecrets, type SecretMatch } from "../observability/redact";

export interface ReadFileResult {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  lineCount: number;
  secretMatches: SecretMatch[];
}

export interface ReadFileOptions {
  maxBytes: number;
  userExclusions?: string[];
  /** Secret matches are replaced with [REDACTED] before the content is returned. */
  redact?: boolean;
  maxLines?: number;
}

export async function readRepositoryFile(
  repositoryRoot: string,
  relativePath: string,
  options: ReadFileOptions,
): Promise<ReadFileResult> {
  assertPathAllowed(relativePath, options.userExclusions ?? []);
  if (isBinaryExtension(relativePath)) {
    throw new AppError("FILE_EXCLUDED", "Binary files are not readable in the analysis context.");
  }

  const absolute = await resolveRepoFile(repositoryRoot, relativePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) {
    throw new AppError("FILE_NOT_FOUND", "The selected path is not a file.");
  }
  if (stat.size > options.maxBytes) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `The file is larger than the ${Math.round(options.maxBytes / 1024)} KB limit.`,
    );
  }

  const buffer = await fs.readFile(absolute);
  if (looksBinaryContent(buffer)) {
    throw new AppError("FILE_EXCLUDED", "Binary files are not readable in the analysis context.");
  }

  let content = buffer.toString("utf8");
  let truncated = false;
  const maxLines = options.maxLines ?? 4000;
  const lines = content.split(/\r?\n/);
  if (lines.length > maxLines) {
    content = lines.slice(0, maxLines).join("\n");
    truncated = true;
  }

  const secretMatches = scanForSecrets(content);
  if (options.redact && secretMatches.length > 0) {
    content = redactSecrets(content);
  }

  return {
    path: relativePath.replace(/\\/g, "/"),
    content,
    bytes: stat.size,
    truncated,
    lineCount: content.split(/\r?\n/).length,
    secretMatches,
  };
}

export interface TreeEntry {
  path: string;
  directory: boolean;
}

/**
 * List files in a repository. Uses `git ls-files` output supplied by the
 * caller so ignored/untracked content never enters the index, then applies
 * exclusions and limits.
 */
export function filterTrackedFiles(
  files: string[],
  options: { maxFiles: number; userExclusions?: string[] },
): { files: string[]; excluded: number; truncated: boolean } {
  const kept: string[] = [];
  let excluded = 0;
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (evaluatePath(normalized, options.userExclusions).excluded) {
      excluded += 1;
      continue;
    }
    if (kept.length >= options.maxFiles) {
      return { files: kept, excluded, truncated: true };
    }
    kept.push(normalized);
  }
  return { files: kept, excluded, truncated: false };
}

export function buildTree(files: string[]): TreeEntry[] {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return [
    ...[...directories].sort().map((directory) => ({ path: directory, directory: true })),
    ...files.map((file) => ({ path: file, directory: false })),
  ];
}

export function languageFromPath(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".rb": "Ruby", ".go": "Go",
    ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".swift": "Swift", ".php": "PHP",
    ".cs": "C#", ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++", ".scala": "Scala",
    ".sh": "Shell", ".ps1": "PowerShell", ".sql": "SQL", ".html": "HTML", ".css": "CSS",
    ".scss": "SCSS", ".vue": "Vue", ".svelte": "Svelte", ".md": "Markdown", ".mdx": "Markdown",
  };
  return map[ext] ?? null;
}
