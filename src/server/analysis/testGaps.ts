import path from "node:path";
import { listTrackedFiles } from "../git/git";
import { filterTrackedFiles, readRepositoryFile } from "../fs/readFile";
import type { ModelFinding } from "../models/types";
import { SEVERITY_RANK } from "@/shared/constants";

const TEST_FILE_PATTERN =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)(tests?|__tests__|spec)\/)|(_test\.go$)|(^test_.*\.py$)|(_test\.py$)|(Test\.java$)/i;

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|c|cpp|h|hpp|scala|swift)$/i;

const HIGH_RISK_PATH = /(auth|session|login|password|payment|billing|checkout|security|crypto|token|permission|role|admin|api|db|database|migration|upload|webhook)/i;

const MAX_SOURCE_FILES = 120;
const MAX_TEST_FILES = 200;
const MAX_FINDINGS = 12;

export interface TestGapResult {
  findings: ModelFinding[];
  sourceFiles: number;
  testFiles: number;
  coveredModules: number;
  untestedModules: number;
  notes: string[];
}

/**
 * Deterministic, deliberately conservative coverage mapping: a module counts as
 * covered only when an existing test file references its basename. This is not
 * line coverage and the report says so.
 */
export async function analyzeTestGaps(
  repositoryRoot: string,
  options: { maxFiles: number; userExclusions: string[] },
): Promise<TestGapResult> {
  const tracked = await listTrackedFiles(repositoryRoot, options.maxFiles * 2);
  const filtered = filterTrackedFiles(tracked.files, {
    maxFiles: options.maxFiles,
    userExclusions: options.userExclusions,
  });

  const testFiles = filtered.files.filter((file) => TEST_FILE_PATTERN.test(file));
  const sourceFiles = filtered.files.filter(
    (file) => SOURCE_FILE_PATTERN.test(file) && !TEST_FILE_PATTERN.test(file),
  );

  const testCorpus: string[] = [];
  for (const file of testFiles.slice(0, MAX_TEST_FILES)) {
    try {
      const read = await readRepositoryFile(repositoryRoot, file, {
        maxBytes: 200_000,
        userExclusions: options.userExclusions,
        maxLines: 4000,
      });
      testCorpus.push(read.content.toLowerCase());
    } catch {
      // Unreadable test files simply contribute nothing to coverage detection.
    }
  }
  const corpus = testCorpus.join("\n");

  const uncovered: { file: string; severity: "high" | "medium" | "low" }[] = [];
  let covered = 0;
  for (const file of sourceFiles.slice(0, MAX_SOURCE_FILES)) {
    const base = path.posix.basename(file).replace(SOURCE_FILE_PATTERN, "").toLowerCase();
    const directory = path.posix.dirname(file).split("/").pop()?.toLowerCase() ?? "";
    const hints = [base, directory].filter((hint) => hint.length >= 3);
    const isCovered = hints.some((hint) => corpus.includes(hint));
    if (isCovered) {
      covered += 1;
      continue;
    }
    const severity = HIGH_RISK_PATH.test(file) ? "high" : "low";
    uncovered.push({ file, severity });
  }

  const notes: string[] = [];
  if (testFiles.length === 0) {
    notes.push("No test files were detected in the tracked file set.");
  }
  if (sourceFiles.length > MAX_SOURCE_FILES) {
    notes.push(`Only the first ${MAX_SOURCE_FILES} source files were checked for test references.`);
  }
  notes.push(
    "Coverage here means 'a test file references the module name'. It is not line coverage and does not prove behaviour is tested.",
  );

  const findings: ModelFinding[] = uncovered
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, MAX_FINDINGS)
    .map((entry) => ({
      category: "testing",
      severity: entry.severity,
      title: `No test reference found for ${path.posix.basename(entry.file)}`,
      description:
        "No test file appears to import or reference this module. Behaviour changes here could ship without automated verification.",
      evidence: `Source file ${entry.file} has no matching reference in the ${testFiles.length} detected test file(s).`,
      filePath: entry.file,
      startLine: null,
      endLine: null,
      confidence: "medium",
      remediation:
        "Add focused tests for the module's main success path and at least one failure path, or confirm coverage is provided by an integration test outside this repository.",
    }));

  if (testFiles.length === 0) {
    findings.unshift({
      category: "testing",
      severity: "high",
      title: "Repository has no detectable test files",
      description:
        "No files matching common test naming conventions were found in the tracked file set. There is no automated evidence that this code behaves as intended.",
      evidence: `${sourceFiles.length} source files were found and 0 test files.`,
      filePath: null,
      startLine: null,
      endLine: null,
      confidence: "high",
      remediation:
        "Add a test runner and a small suite covering the highest-risk modules first, then wire it into CI.",
    });
  }

  return {
    findings,
    sourceFiles: sourceFiles.length,
    testFiles: testFiles.length,
    coveredModules: covered,
    untestedModules: uncovered.length,
    notes,
  };
}
