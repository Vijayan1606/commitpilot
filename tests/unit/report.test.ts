import { describe, expect, it } from "vitest";
import {
  buildAnalysisJson,
  countBySeverity,
  renderAnalysisMarkdown,
  renderPatchMarkdown,
  sanitizeFilename,
  type ReportMeta,
} from "@/server/reports/report";
import type { AnalysisJobRecord, FindingRecord, PatchRecord, RepositoryRecord } from "@/shared/types";

const repository: RepositoryRecord = {
  id: "repo_1",
  name: "sample-app",
  path: "/tmp/sample-app",
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  lastCheckedAt: null,
};

const job: AnalysisJobRecord = {
  id: "job_1",
  repositoryId: "repo_1",
  analysisType: "repository_analysis",
  status: "completed",
  stage: "completed",
  progress: 100,
  request: "Analyse it",
  summary: "A small app.",
  errorCode: null,
  errorMessage: null,
  modelProvider: "openai-compatible:127.0.0.1",
  modelName: "qwen2.5-coder:7b",
  correlationId: "corr_1",
  startedAt: "2026-10-26T00:00:01.000Z",
  completedAt: "2026-10-26T00:00:30.000Z",
  createdAt: "2026-10-26T00:00:00.000Z",
};

const finding: FindingRecord = {
  id: "find_1",
  analysisJobId: "job_1",
  category: "correctness",
  severity: "high",
  title: "Expired sessions accepted",
  description: "The expiry claim is never checked.",
  filePath: "src/auth/session.ts",
  startLine: 5,
  endLine: 5,
  confidence: "high",
  evidence: "const payload = decode(token);",
  verificationStatus: "path_verified_model_hypothesis",
  source: "model",
  remediation: "Check payload.exp.",
};

const meta: ReportMeta = {
  repository,
  job,
  overview: {
    branch: "main",
    headCommit: "abcdef1234567890",
    isDirty: false,
    fileCount: 12,
    languages: [{ language: "TypeScript", percent: 90 }],
    frameworks: ["Express"],
    packageManager: "npm",
    testFileCount: 1,
  },
  findings: [finding],
  model: { provider: "openai-compatible:127.0.0.1", name: "qwen2.5-coder:7b" },
  limitations: ["Only a subset of files was supplied."],
};

describe("report generation", () => {
  it("renders findings, evidence, and the verification legend", () => {
    const markdown = renderAnalysisMarkdown(meta);
    expect(markdown).toContain("# Repository analysis: sample-app");
    expect(markdown).toContain("Expired sessions accepted");
    expect(markdown).toContain("src/auth/session.ts:5");
    expect(markdown).toContain("path_verified_model_hypothesis");
    expect(markdown).toContain("Only a subset of files was supplied.");
    expect(markdown).toContain("A finding is never marked verified because a model suggested it.");
  });

  it("states clearly when there are no findings", () => {
    const markdown = renderAnalysisMarkdown({ ...meta, findings: [] });
    expect(markdown).toContain("No findings were reported");
    expect(markdown).toContain("not proof that the code is correct");
  });

  it("produces parseable JSON without a credential", () => {
    const parsed = JSON.parse(buildAnalysisJson(meta)) as Record<string, unknown>;
    expect(parsed.tool).toBeTruthy();
    expect(parsed.findings).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain("apiKey");
  });

  it("counts findings by severity", () => {
    const counts = countBySeverity([finding, { ...finding, severity: "low" }]);
    expect(counts.high).toBe(1);
    expect(counts.low).toBe(1);
    expect(counts.critical).toBe(0);
  });

  it("sanitises export filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeFilename("sample app — review")).toBe("sample-app-review");
    expect(sanitizeFilename("")).toBe("commitpilot-report");
  });

  it("renders a patch report that states nothing was applied", () => {
    const patch: PatchRecord = {
      id: "patch_1",
      repositoryId: "repo_1",
      jobId: null,
      title: "Guard expiry",
      rationale: "Adds an expiry check.",
      patchText: "diff --git a/a b/a\n",
      files: ["src/auth/session.ts"],
      status: "proposed",
      validation: {
        ok: true,
        checkedAt: "2026-10-26T00:00:00.000Z",
        errors: [],
        filesTouched: ["src/auth/session.ts"],
        appliesCleanly: true,
        diffStat: null,
      },
      createdAt: "2026-10-26T00:00:00.000Z",
      appliedAt: null,
    };
    const markdown = renderPatchMarkdown(patch, repository);
    expect(markdown).toContain("No file is modified until the patch is approved explicitly.");
    expect(markdown).toContain("```diff");
  });
});
