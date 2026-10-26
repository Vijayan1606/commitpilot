import path from "node:path";
import { MANIFEST_FILES, LANGUAGE_BY_EXTENSION } from "@/shared/constants";
import type { RepositoryOverview } from "@/shared/types";
import { getGitStatus, getRecentCommits, listTrackedFiles } from "../git/git";
import { filterTrackedFiles, languageFromPath, readRepositoryFile } from "../fs/readFile";
import { nowIso } from "../observability/ids";

const FRAMEWORK_SIGNALS: Record<string, string> = {
  next: "Next.js",
  react: "React",
  vue: "Vue",
  nuxt: "Nuxt",
  "@angular/core": "Angular",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  express: "Express",
  fastify: "Fastify",
  koa: "Koa",
  "@nestjs/core": "NestJS",
  hono: "Hono",
  electron: "Electron",
  tailwindcss: "Tailwind CSS",
  prisma: "Prisma",
  "@prisma/client": "Prisma",
  mongoose: "Mongoose",
  sequelize: "Sequelize",
  typeorm: "TypeORM",
  drizzle: "Drizzle ORM",
  jest: "Jest",
  vitest: "Vitest",
  playwright: "Playwright",
  "@playwright/test": "Playwright",
  mocha: "Mocha",
  cypress: "Cypress",
};

const TEST_FILE_PATTERN =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(test|tests|__tests__|spec)\/|(_test\.go$)|(^test_.*\.py$)|(_test\.py$)|(Test\.java$)/i;

export interface InspectOptions {
  maxFiles: number;
  userExclusions: string[];
}

export interface RepositoryOverviewWithCommits extends RepositoryOverview {
  commits: { shortHash: string; author: string; date: string; subject: string }[];
}

export async function inspectRepository(
  repositoryPath: string,
  name: string,
  options: InspectOptions,
): Promise<RepositoryOverviewWithCommits> {
  const [status, commits, tracked] = await Promise.all([
    getGitStatus(repositoryPath),
    getRecentCommits(repositoryPath, 8),
    listTrackedFiles(repositoryPath, options.maxFiles * 2),
  ]);

  const filtered = filterTrackedFiles(tracked.files, {
    maxFiles: options.maxFiles,
    userExclusions: options.userExclusions,
  });

  const languageCounts = new Map<string, number>();
  const testDirectories = new Set<string>();
  let testFileCount = 0;
  let sourceFileCount = 0;
  const manifests: string[] = [];
  let packageManager: string | null = null;

  const lowerFiles = filtered.files.map((file) => file.toLowerCase());
  if (lowerFiles.includes("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (lowerFiles.includes("yarn.lock")) packageManager = "yarn";
  else if (lowerFiles.includes("bun.lockb")) packageManager = "bun";
  else if (lowerFiles.includes("package-lock.json")) packageManager = "npm";
  else if (lowerFiles.includes("pyproject.toml") || lowerFiles.includes("requirements.txt")) packageManager = "pip/poetry";
  else if (lowerFiles.includes("go.mod")) packageManager = "go modules";
  else if (lowerFiles.includes("cargo.toml")) packageManager = "cargo";
  else if (lowerFiles.includes("gemfile")) packageManager = "bundler";
  else if (lowerFiles.includes("composer.json")) packageManager = "composer";

  for (const file of filtered.files) {
    const language = LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()] ?? languageFromPath(file);
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    if (TEST_FILE_PATTERN.test(file)) {
      testFileCount += 1;
      const first = file.split("/")[0];
      if (first && (file.includes("/tests/") || file.includes("/test/") || file.includes("/__tests__/"))) {
        testDirectories.add(first);
      }
    }
    if (/\.[cm]?[jt]sx?$|\.py$|\.go$|\.rs$|\.java$|\.rb$|\.php$|\.cs$|\.kt$/.test(file)) {
      sourceFileCount += 1;
    }
    const base = path.posix.basename(file);
    if ((MANIFEST_FILES as readonly string[]).includes(base) && file.split("/").length <= 2) {
      manifests.push(file);
    }
  }

  const totalLanguageFiles = [...languageCounts.values()].reduce((sum, count) => sum + count, 0) || 1;
  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([language, files]) => ({
      language,
      files,
      percent: Math.round((files / totalLanguageFiles) * 100),
    }));

  const frameworks = new Set<string>();
  const packageJson = filtered.files.find((file) => file === "package.json");
  if (packageJson) {
    try {
      const file = await readRepositoryFile(repositoryPath, "package.json", {
        maxBytes: 262_144,
        userExclusions: options.userExclusions,
      });
      const parsed = JSON.parse(file.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
      for (const [dependency, label] of Object.entries(FRAMEWORK_SIGNALS)) {
        if (dependency in deps) frameworks.add(label);
      }
    } catch {
      // A malformed package.json is reported by the analysis, not here.
    }
  }
  if (filtered.files.some((file) => file.endsWith("go.mod"))) frameworks.add("Go modules");
  if (filtered.files.some((file) => file.endsWith("Cargo.toml"))) frameworks.add("Cargo");
  if (filtered.files.some((file) => file.endsWith("requirements.txt") || file.endsWith("pyproject.toml"))) {
    frameworks.add("Python packaging");
  }

  return {
    name,
    path: repositoryPath,
    branch: status.branch,
    headCommit: status.headCommit,
    isDirty: status.isDirty,
    changedFiles: status.staged.length + status.modified.length + status.deleted.length,
    untrackedFiles: status.untracked.length,
    fileCount: filtered.files.length,
    languages,
    packageManager,
    frameworks: [...frameworks].sort(),
    manifests: manifests.sort(),
    testDirectories: [...testDirectories].sort(),
    testFileCount,
    sourceFileCount,
    truncated: filtered.truncated || tracked.truncated || filtered.excluded > 0,
    scannedAt: nowIso(),
    commits: commits.map((commit) => ({
      shortHash: commit.shortHash,
      author: commit.author,
      date: commit.date,
      subject: commit.subject,
    })),
  };
}
