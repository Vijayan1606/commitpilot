import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startAnalysis } from "@/server/analysis/orchestrator";
import { getPatch, getReportByJobId, listFindings, listReviews } from "@/server/db/analysis";
import { createRepository } from "@/server/db/repositories";
import { inspectRepository } from "@/server/inspection/overview";
import { searchCode } from "@/server/analysis/search";
import { runStaticSecurityScan } from "@/server/analysis/securityRules";
import { analyzeTestGaps } from "@/server/analysis/testGaps";
import { filterTrackedFiles, readRepositoryFile } from "@/server/fs/readFile";
import { listTrackedFiles } from "@/server/git/git";
import { decidePatch, proposePatchWorkflow } from "@/server/patches/workflow";
import { waitForJob } from "@/server/tools";
import {
  clearModelEnv,
  EXAMPLE_AWS_KEY,
  makeTempRepo,
  startFakeModel,
  withModelEnv,
  chatCompletion,
  VALID_ANALYSIS,
  SAMPLE_FILES,
} from "../helpers";

const settingsFor = { maxFiles: 200, userExclusions: [] };

const PATCH_DIFF = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -3,4 +3,5 @@
 export function verifySession(token: string) {
   const payload = decode(token);
+  if (!payload.exp || payload.exp < Date.now()) return false;
   return payload.userId !== undefined;
 }
`;

const PATCH_PROPOSAL = {
  title: "Reject expired sessions",
  rationale: "Adds an expiry check before returning a valid session.",
  files: ["src/auth/session.ts"],
  unifiedDiff: PATCH_DIFF,
  notes: null,
};

let fake: Awaited<ReturnType<typeof startFakeModel>>;

function responder(request: { rawBody: string }) {
  if (request.rawBody.includes("unifiedDiff")) {
    return { body: chatCompletion(PATCH_PROPOSAL) };
  }
  return { body: chatCompletion(VALID_ANALYSIS) };
}

beforeAll(async () => {
  fake = await startFakeModel(responder);
});

afterAll(async () => {
  await fake.close();
});

afterEach(() => {
  clearModelEnv();
  fake.setResponder(responder);
  process.env.COMMITPILOT_ALLOW_PATCH_APPLY = "false";
});

describe("repository registry and inspection", () => {
  it("registers, inspects, and excludes secrets and dependencies", async () => {
    const repoPath = makeTempRepo(SAMPLE_FILES, "inspect");
    const repository = createRepository("sample-app", repoPath);
    expect(repository.id).toMatch(/^repo_/);

    const overview = await inspectRepository(repoPath, repository.name, settingsFor);
    expect(overview.branch).toBeTruthy();
    expect(overview.languages.some((entry) => entry.language === "TypeScript")).toBe(true);
    expect(overview.frameworks).toContain("Express");
    expect(overview.packageManager).toBe("npm");
    expect(overview.testFileCount).toBeGreaterThanOrEqual(1);
    expect(overview.manifests).toContain("package.json");

    const tracked = await listTrackedFiles(repoPath, 1000);
    const filtered = filterTrackedFiles(tracked.files, { maxFiles: 1000, userExclusions: [] });
    expect(filtered.files).not.toContain(".env");
    expect(filtered.files.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(filtered.files).toContain("src/auth/session.ts");

    await expect(
      readRepositoryFile(repoPath, ".env", { maxBytes: 100_000, userExclusions: [] }),
    ).rejects.toMatchObject({ code: "FILE_EXCLUDED" });
  });

  it("searches real code and never returns excluded files", async () => {
    const repoPath = makeTempRepo(SAMPLE_FILES, "search");
    const result = await searchCode(repoPath, "verifySession", settingsFor);
    expect(result.files.some((file) => file.path === "src/auth/session.ts")).toBe(true);

    const secret = await searchCode(repoPath, "supersecretvalue12345", settingsFor);
    expect(secret.matches).toHaveLength(0);
    expect(secret.message).toBeTruthy();
  });

  it("finds deterministic security leads with evidence", async () => {
    const repoPath = makeTempRepo(SAMPLE_FILES, "security");
    const scan = await runStaticSecurityScan(repoPath, settingsFor);
    expect(scan.scannedFiles).toBeGreaterThan(0);
    const shell = scan.findings.find((finding) => finding.title.includes("Shell command"));
    expect(shell).toBeTruthy();
    expect(shell?.filePath).toBe("src/db.ts");
    expect(shell?.startLine).toBeGreaterThan(0);
  });

  it("finds untested modules deterministically", async () => {
    const repoPath = makeTempRepo(SAMPLE_FILES, "testgaps");
    const result = await analyzeTestGaps(repoPath, settingsFor);
    expect(result.testFiles).toBeGreaterThanOrEqual(1);
    expect(result.findings.some((finding) => finding.filePath === "src/db.ts")).toBe(true);
    expect(result.notes.join(" ")).toContain("not line coverage");
  });
});

describe("AI analysis with a real HTTP model endpoint", () => {
  it("runs an analysis, verifies findings, and saves a report", async () => {
    withModelEnv(fake.url);
    const repoPath = makeTempRepo(SAMPLE_FILES, "analysis");
    const repository = createRepository("sample-app", repoPath);

    const job = await startAnalysis({
      repositoryId: repository.id,
      type: "repository_analysis",
      question: "Find likely bugs in the authentication module.",
    });
    const finished = await waitForJob(job.id, 20_000);
    expect(finished.status).toBe("completed");
    expect(finished.errorCode).toBeNull();

    const findings = listFindings(job.id);
    expect(findings.length).toBeGreaterThan(0);
    const authFinding = findings.find((finding) => finding.title === "Session expiry is never checked");
    expect(authFinding).toBeTruthy();
    expect(authFinding?.filePath).toBe("src/auth/session.ts");
    expect(authFinding?.verificationStatus).toBe("path_verified_model_hypothesis");
    expect(authFinding?.source).toBe("model");

    const report = getReportByJobId(job.id);
    expect(report).toBeTruthy();
    expect(report?.markdown).toContain("Session expiry is never checked");
    expect(report?.markdown).toContain("Limitations");

    expect(fake.requests.length).toBeGreaterThan(0);
    const request = fake.requests[0];
    expect(request?.authorization).toBe("Bearer test-key-1234567890");
    expect(request?.rawBody).not.toContain("supersecretvalue12345");
    expect(request?.rawBody).not.toContain(EXAMPLE_AWS_KEY);
    expect(request?.rawBody).toContain("untrusted");
  });

  it("fails honestly when the model provider is unavailable", async () => {
    withModelEnv(fake.url);
    fake.setResponder(() => ({ status: 500, body: { error: "upstream down" } }));
    const repoPath = makeTempRepo(SAMPLE_FILES, "model-down");
    const repository = createRepository("model-down", repoPath);

    const job = await startAnalysis({ repositoryId: repository.id, type: "repository_analysis" });
    const finished = await waitForJob(job.id, 20_000);
    expect(finished.status).toBe("failed");
    expect(finished.errorCode).toBe("MODEL_UNAVAILABLE");
    expect(listFindings(job.id)).toHaveLength(0);
    expect(getReportByJobId(job.id)).toBeNull();
  });

  it("rejects a malformed model response instead of inventing a report", async () => {
    withModelEnv(fake.url);
    fake.setResponder(() => ({ body: chatCompletion("this is not json at all") }));
    const repoPath = makeTempRepo(SAMPLE_FILES, "model-malformed");
    const repository = createRepository("model-malformed", repoPath);

    const job = await startAnalysis({ repositoryId: repository.id, type: "repository_analysis" });
    const finished = await waitForJob(job.id, 20_000);
    expect(finished.status).toBe("failed");
    expect(finished.errorCode).toBe("MODEL_INVALID_RESPONSE");
    expect(listFindings(job.id)).toHaveLength(0);
  });

  it("reviews real uncommitted changes", async () => {
    withModelEnv(fake.url);
    const repoPath = makeTempRepo(SAMPLE_FILES, "review");
    const repository = createRepository("review", repoPath);
    fs.writeFileSync(
      path.join(repoPath, "src/auth/session.ts"),
      "import { decode } from \"./jwt\";\n\nexport function verifySession(token: string) {\n  const payload = decode(token);\n  // NOTE: expiry is checked by the caller (it is not).\n  return Boolean(payload.userId);\n}\n",
    );

    const job = await startAnalysis({
      repositoryId: repository.id,
      type: "code_review",
      question: "Review the authentication changes.",
      diffMode: "both",
    });
    const finished = await waitForJob(job.id, 20_000);
    expect(finished.status).toBe("completed");

    const reviews = listReviews(10).filter((review) => review.jobId === job.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.changedFiles).toContain("src/auth/session.ts");
    expect(fake.requests.some((request) => request.rawBody.includes("diff --git"))).toBe(true);
  });

  it("completes a security review deterministically without a model", async () => {
    clearModelEnv();
    const repoPath = makeTempRepo(SAMPLE_FILES, "security-job");
    const repository = createRepository("security-job", repoPath);

    const job = await startAnalysis({ repositoryId: repository.id, type: "security_review" });
    const finished = await waitForJob(job.id, 20_000);
    expect(finished.status).toBe("completed");
    const findings = listFindings(job.id);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.source === "static_rule")).toBe(true);
    const report = getReportByJobId(job.id);
    expect(report?.markdown).toContain("not a comprehensive security audit");
  });
});

describe("patch workflow", () => {
  it("proposes, validates, and rejects a patch without modifying files", async () => {
    withModelEnv(fake.url);
    const repoPath = makeTempRepo(SAMPLE_FILES, "patch-propose");
    const repository = createRepository("patch-propose", repoPath);
    const before = fs.readFileSync(path.join(repoPath, "src/auth/session.ts"), "utf8");

    const patch = await proposePatchWorkflow({
      repositoryId: repository.id,
      request: "Reject expired sessions in verifySession.",
      filePaths: ["src/auth/session.ts"],
    });
    expect(patch.status).toBe("proposed");
    expect(patch.validation.ok).toBe(true);
    expect(patch.files).toEqual(["src/auth/session.ts"]);

    const decision = await decidePatch({ patchId: patch.id, approve: false });
    expect(decision.patch.status).toBe("rejected");
    expect(fs.readFileSync(path.join(repoPath, "src/auth/session.ts"), "utf8")).toBe(before);
    expect(getPatch(patch.id)?.status).toBe("rejected");
  });

  it("applies an approved patch only when the server flag allows it", async () => {
    withModelEnv(fake.url);
    process.env.COMMITPILOT_ALLOW_PATCH_APPLY = "true";
    const repoPath = makeTempRepo(SAMPLE_FILES, "patch-apply");
    const repository = createRepository("patch-apply", repoPath);

    const patch = await proposePatchWorkflow({
      repositoryId: repository.id,
      request: "Reject expired sessions in verifySession.",
      filePaths: ["src/auth/session.ts"],
    });
    const decision = await decidePatch({ patchId: patch.id, approve: true });
    expect(decision.patch.status).toBe("applied");
    expect(decision.changedFiles).toContain("src/auth/session.ts");
    expect(fs.readFileSync(path.join(repoPath, "src/auth/session.ts"), "utf8")).toContain("payload.exp");
    expect(decision.backupDirectory).toBeTruthy();
  });
});
