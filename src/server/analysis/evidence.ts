import path from "node:path";
import { listTrackedFiles } from "../git/git";
import { filterTrackedFiles, readRepositoryFile } from "../fs/readFile";
import type { EvidenceFile, RepositoryFacts } from "../models/types";
import { logger } from "../observability/logger";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "about", "where", "which",
  "what", "when", "how", "does", "did", "are", "was", "were", "you", "your", "please",
  "find", "show", "explain", "review", "analyse", "analyze", "identify", "list", "give",
  "repo", "repository", "code", "file", "files", "function", "functions", "module",
  "modules", "call", "calls", "called", "used", "uses", "use", "implemented",
  "implementation", "current", "there", "their", "these", "those", "have", "has", "can",
  "should", "would", "could", "most", "important", "possible", "likely", "bugs", "bug",
  "issue", "issues", "problem", "problems", "quality", "change", "changes", "diff",
]);

const ENTRY_POINT_PATTERN =
  /(^|\/)(index|main|app|server|cli|bootstrap|startup|worker|handler)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php)$/i;

const CONFIG_PATTERN =
  /(^|\/)(package\.json|tsconfig\.json|next\.config\.[jt]s|vite\.config\.[jt]s|webpack\.config\.[jt]s|docker-compose\.ya?ml|Dockerfile|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?)$/i;

const SOURCE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|c|cpp|h|hpp|scala|swift|sh|sql|vue|svelte)$/i;
const TEST_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)(tests?|__tests__|spec)\/)|(_test\.go$)|(^test_.*\.py$)|(_test\.py$)/i;
const DOC_PATTERN = /\.(md|mdx|txt|rst)$/i;

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of matches) {
    if (STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= 12) break;
  }
  return tokens;
}

export interface ScoredFile {
  path: string;
  score: number;
}

export function scoreFiles(
  files: string[],
  question: string,
  mode: "repository" | "plan" | "test_gaps" | "security" | "review",
): ScoredFile[] {
  const tokens = tokenize(question);
  return files
    .map((file) => {
      const lower = file.toLowerCase();
      const base = path.posix.basename(lower);
      let score = 0;
      if (SOURCE_PATTERN.test(lower)) score += 6;
      if (ENTRY_POINT_PATTERN.test(lower)) score += 6;
      if (CONFIG_PATTERN.test(lower)) score += 5;
      if (DOC_PATTERN.test(lower)) score += 1;
      const isTest = TEST_PATTERN.test(lower);
      if (mode === "test_gaps") score += isTest ? 8 : 2;
      else if (isTest) score += 1;

      for (const token of tokens) {
        if (lower.includes(token)) score += 12;
        else if (base.includes(token)) score += 8;
      }
      const depth = file.split("/").length - 1;
      score -= Math.min(depth, 5);
      if (/(^|\/)(docs?|examples?|fixtures?|mocks?|__snapshots__)\//i.test(lower)) score -= 4;
      return { path: file, score };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

const MAX_EVIDENCE_FILE_CHARS = 9_000;

function clip(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_EVIDENCE_FILE_CHARS) return { content, truncated: false };
  const head = content.slice(0, 7_000);
  const tail = content.slice(-1_500);
  return { content: `${head}\n\n[... ${content.length - 8_500} characters omitted ...]\n\n${tail}`, truncated: true };
}

export interface EvidenceResult {
  files: EvidenceFile[];
  omitted: number;
  truncated: boolean;
}

export async function gatherEvidence(
  repositoryRoot: string,
  options: {
    question: string;
    mode: "repository" | "plan" | "test_gaps" | "security" | "review";
    maxFiles: number;
    maxFileBytes: number;
    maxContextChars: number;
    userExclusions: string[];
    preferredFiles?: string[];
  },
): Promise<EvidenceResult> {
  const tracked = await listTrackedFiles(repositoryRoot, options.maxFiles * 2);
  const filtered = filterTrackedFiles(tracked.files, {
    maxFiles: options.maxFiles,
    userExclusions: options.userExclusions,
  });
  const scored = scoreFiles(filtered.files, options.question, options.mode);

  const preferred = new Set((options.preferredFiles ?? []).map((file) => file.replace(/\\/g, "/")));
  for (const entry of scored) {
    if (preferred.has(entry.path)) entry.score += 50;
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const budget = Math.max(Math.floor(options.maxContextChars * 0.7), 8_000);
  let used = 0;
  let truncated = false;
  const files: EvidenceFile[] = [];

  for (const entry of scored) {
    if (files.length >= 26) {
      truncated = true;
      break;
    }
    if (used >= budget) {
      truncated = true;
      break;
    }
    try {
      const file = await readRepositoryFile(repositoryRoot, entry.path, {
        maxBytes: options.maxFileBytes,
        userExclusions: options.userExclusions,
        redact: true,
        maxLines: 800,
      });
      const clipped = clip(file.content);
      if (clipped.truncated || file.truncated) truncated = true;
      used += clipped.content.length;
      files.push({
        path: entry.path,
        content: clipped.content,
        bytes: file.bytes,
        truncated: clipped.truncated || file.truncated,
        redactions: file.secretMatches.length,
      });
    } catch (error) {
      logger.debug("evidence_file_skipped", {
        path: entry.path,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return {
    files,
    omitted: Math.max(scored.length - files.length, 0),
    truncated,
  };
}

export function factsFromOverview(overview: {
  name: string;
  branch: string | null;
  isDirty: boolean;
  fileCount: number;
  languages: { language: string; files: number; percent: number }[];
  frameworks: string[];
  packageManager: string | null;
  manifests: string[];
  testFileCount: number;
  sourceFileCount: number;
  commits: { shortHash: string; subject: string }[];
}): RepositoryFacts {
  return {
    name: overview.name,
    branch: overview.branch,
    isDirty: overview.isDirty,
    fileCount: overview.fileCount,
    languages: overview.languages,
    frameworks: overview.frameworks,
    packageManager: overview.packageManager,
    manifests: overview.manifests,
    testFileCount: overview.testFileCount,
    sourceFileCount: overview.sourceFileCount,
    recentCommits: overview.commits.map((commit) => ({
      shortHash: commit.shortHash,
      subject: commit.subject,
    })),
  };
}
