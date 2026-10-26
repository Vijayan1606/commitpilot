import { git, listTrackedFiles } from "../git/git";
import { filterTrackedFiles } from "../fs/readFile";
import { evaluatePath } from "../fs/exclusions";
import { redactSecrets } from "../observability/redact";
import { tokenize } from "./evidence";
import { AppError } from "../errors";

export interface SearchMatch {
  path: string;
  line: number;
  snippet: string;
  score: number;
}

export interface SearchResult {
  query: string;
  tokens: string[];
  matches: SearchMatch[];
  files: { path: string; matches: number }[];
  truncated: boolean;
  message: string | null;
}

const MAX_MATCHES = 300;
const MAX_RESULTS = 20;

export async function searchCode(
  repositoryRoot: string,
  query: string,
  options: { maxFiles: number; userExclusions: string[] },
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new AppError("INVALID_ARGUMENTS", "A search query is required.");
  }
  if (trimmed.length > 300) {
    throw new AppError("INVALID_ARGUMENTS", "The search query is too long.");
  }

  const tokens = tokenize(trimmed);
  const searchTerms = tokens.length > 0 ? tokens : [trimmed.toLowerCase()];

  const tracked = await listTrackedFiles(repositoryRoot, options.maxFiles);
  const filtered = filterTrackedFiles(tracked.files, {
    maxFiles: options.maxFiles,
    userExclusions: options.userExclusions,
  });
  const allowed = new Set(filtered.files);

  const args = ["grep", "-n", "-I", "-i", "--no-color", "-F"];
  for (const term of searchTerms.slice(0, 8)) args.push("-e", term);
  const result = await git(repositoryRoot, args, { allowFailure: true, timeoutMs: 20_000 });

  const rawMatches: SearchMatch[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    const parsed = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!parsed) continue;
    const [, file, lineNumber, rawContent] = parsed;
    const content = rawContent ?? "";
    if (!file || !lineNumber) continue;
    const normalized = file.replace(/\\/g, "/");
    if (!allowed.has(normalized)) continue;
    if (evaluatePath(normalized, options.userExclusions).excluded) continue;

    const lowered = content.toLowerCase();
    let score = 0;
    for (const term of searchTerms) {
      if (lowered.includes(term)) score += 5;
      if (normalized.toLowerCase().includes(term)) score += 3;
    }
    rawMatches.push({
      path: normalized,
      line: Number.parseInt(lineNumber, 10),
      snippet: redactSecrets(content.trim()).slice(0, 300),
      score,
    });
    if (rawMatches.length >= MAX_MATCHES) break;
  }

  const truncated = rawMatches.length >= MAX_MATCHES;
  rawMatches.sort((a, b) => b.score - a.score);

  const perFile = new Map<string, SearchMatch[]>();
  for (const match of rawMatches) {
    const list = perFile.get(match.path) ?? [];
    if (list.length >= 4) continue;
    list.push(match);
    perFile.set(match.path, list);
  }

  const rankedFiles = [...perFile.entries()]
    .map(([file, matches]) => ({
      path: file,
      matches: matches.length,
      best: matches.reduce((sum, match) => sum + match.score, 0),
    }))
    .sort((a, b) => b.best - a.best || a.path.localeCompare(b.path))
    .slice(0, MAX_RESULTS);

  const matches: SearchMatch[] = [];
  for (const file of rankedFiles) {
    matches.push(...(perFile.get(file.path) ?? []));
  }

  return {
    query: trimmed,
    tokens: searchTerms,
    matches: matches.slice(0, 80),
    files: rankedFiles.map((file) => ({ path: file.path, matches: file.matches })),
    truncated,
    message:
      rawMatches.length === 0
        ? "No tracked, non-excluded file contains those terms. Try a symbol name, a shorter phrase, or a different wording."
        : null,
  };
}
