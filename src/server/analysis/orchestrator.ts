import { MAX_FINDINGS, SEVERITY_RANK, type AnalysisType, type Severity } from "@/shared/constants";
import type { AnalysisJobRecord, FindingRecord } from "@/shared/types";
import { getSettings, getWorkspaceRoot, resolveModelConfig } from "../config/settings";
import {
  createJob,
  createReport,
  createReview,
  findActiveJob,
  getJob,
  insertFindings,
  updateJob,
} from "../db/analysis";
import { getRepository, recordOperation } from "../db/repositories";
import { AppError, toAppError } from "../errors";
import { getDiff, type DiffMode } from "../git/git";
import { inspectRepository } from "../inspection/overview";
import { createModelProvider } from "../models/provider";
import type { ModelAnalysis, RepositoryFacts } from "../models/types";
import { logger } from "../observability/logger";
import { correlationId, nowIso } from "../observability/ids";
import { resolveRepositoryPath } from "../fs/pathGuard";
import { gatherEvidence, factsFromOverview } from "./evidence";
import { runStaticSecurityScan } from "./securityRules";
import { analyzeTestGaps } from "./testGaps";
import { verifyFindings } from "./findings";
import { buildAnalysisJson, renderAnalysisMarkdown, renderReviewMarkdown, type ReportMeta } from "../reports/report";
import { scheduleJob } from "../jobs/queue";

const DEFAULT_QUESTIONS: Record<AnalysisType, string> = {
  repository_analysis: "Analyse this repository: explain its architecture and report the most important concrete problems.",
  code_review: "Review the current changes for correctness, security, and missing tests.",
  test_gaps: "Identify the most important testing gaps in this repository.",
  security_review: "Look for security weaknesses that warrant investigation.",
  code_search: "Find the relevant code.",
};

export interface StartAnalysisInput {
  repositoryId: string;
  type: AnalysisType;
  question?: string;
  diffMode?: DiffMode;
  range?: string | null;
}

interface JobOutcome {
  summary: string;
  findings: Omit<FindingRecord, "id" | "analysisJobId">[];
  limitations: string[];
  extraSections: { title: string; body: string }[];
  review?: { mode: DiffMode; range: string | null; changedFiles: string[] };
  model: { provider: string | null; name: string | null };
}

export async function startAnalysis(input: StartAnalysisInput): Promise<AnalysisJobRecord> {
  if (input.type === "code_search") {
    throw new AppError("INVALID_ARGUMENTS", "Code search does not create an analysis job.");
  }
  const repository = getRepository(input.repositoryId);
  if (!repository) {
    throw new AppError("REPOSITORY_NOT_FOUND", "The selected repository is not registered.");
  }
  const workspaceRoot = await getWorkspaceRoot();
  await resolveRepositoryPath(workspaceRoot, repository.path);

  const question = (input.question ?? DEFAULT_QUESTIONS[input.type]).trim().slice(0, 2000);
  if (!question) {
    throw new AppError("INVALID_ARGUMENTS", "A question is required.");
  }
  if (input.type === "code_review" && input.diffMode === "commit_range" && !input.range) {
    throw new AppError("INVALID_ARGUMENTS", "A commit range is required for this review mode.");
  }

  const requestKey =
    input.type === "code_review" ? `${question}|${input.diffMode ?? "both"}|${input.range ?? ""}` : question;
  const existing = findActiveJob(repository.id, input.type, requestKey);
  if (existing) return existing;

  const modelConfig = resolveModelConfig();
  const job = createJob({
    repositoryId: repository.id,
    analysisType: input.type,
    request: requestKey,
    correlationId: correlationId(),
    modelProvider: modelConfig.providerLabel,
    modelName: modelConfig.model,
  });

  const mode = input.diffMode ?? "both";
  const range = input.range ?? null;
  scheduleJob(job.id, () => runAnalysisJob(job.id, { question, mode, range }));
  logger.info("job_started", {
    jobId: job.id,
    repositoryId: repository.id,
    type: input.type,
    correlationId: job.correlationId,
  });
  return job;
}

export async function runAnalysisJob(
  jobId: string,
  input: { question: string; mode: DiffMode; range: string | null },
): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new AppError("JOB_NOT_FOUND", "The analysis job no longer exists.");
  if (job.status === "cancelled") return;

  const repository = getRepository(job.repositoryId);
  if (!repository) throw new AppError("REPOSITORY_NOT_FOUND", "The repository registration was removed.");

  const settings = getSettings();
  updateJob(jobId, { status: "running", stage: "validating", progress: 5, startedAt: nowIso() });

  try {
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);

    updateJob(jobId, { stage: "inspecting", progress: 15 });
    const overview = await inspectRepository(repositoryPath, repository.name, {
      maxFiles: settings.limits.maxFiles,
      userExclusions: settings.exclusions,
    });
    const facts = factsFromOverview(overview);

    updateJob(jobId, { stage: "collecting_evidence", progress: 30 });

    let outcome: JobOutcome;
    switch (job.analysisType) {
      case "repository_analysis":
        outcome = await runRepositoryAnalysis(job, repositoryPath, facts, input.question);
        break;
      case "code_review":
        outcome = await runCodeReview(job, repositoryPath, facts, input);
        break;
      case "test_gaps":
        outcome = await runTestGapWorkflow(job, repositoryPath, facts, input.question);
        break;
      case "security_review":
        outcome = await runSecurityWorkflow(job, repositoryPath, facts, input.question);
        break;
      default:
        throw new AppError("INVALID_ARGUMENTS", "Unsupported analysis type.");
    }

    const latest = getJob(jobId);
    if (latest?.status === "cancelled") {
      logger.info("job_cancelled_before_persist", { jobId });
      return;
    }

    updateJob(jobId, { stage: "saving", progress: 90 });
    const capped = outcome.findings
      .sort((a, b) => SEVERITY_RANK[a.severity as Severity] - SEVERITY_RANK[b.severity as Severity])
      .slice(0, MAX_FINDINGS);
    const inserted = insertFindings(jobId, capped);

    const completedAt = nowIso();
    updateJob(jobId, {
      status: "completed",
      stage: "completed",
      progress: 100,
      summary: outcome.summary,
      completedAt,
      errorCode: null,
      errorMessage: null,
    });

    const meta: ReportMeta = {
      repository,
      job: { ...job, status: "completed", summary: outcome.summary, completedAt },
      overview,
      findings: inserted,
      model: outcome.model,
      limitations: outcome.limitations,
      extraSections: outcome.extraSections,
    };
    const markdown =
      job.analysisType === "code_review"
        ? renderReviewMarkdown(meta, null)
        : renderAnalysisMarkdown(meta);
    createReport({
      repositoryId: repository.id,
      jobId,
      reportType: reportTypeFor(job.analysisType),
      title: `${repository.name} — ${labelFor(job.analysisType)} — ${completedAt.slice(0, 10)}`,
      markdown,
      json: buildAnalysisJson(meta),
    });

    if (outcome.review) {
      createReview({
        repositoryId: repository.id,
        jobId,
        mode: outcome.review.mode,
        range: outcome.review.range,
        changedFiles: outcome.review.changedFiles,
        summary: outcome.summary,
      });
    }

    recordOperation({
      repositoryId: repository.id,
      operationType: job.analysisType,
      outcome: "success",
      correlationId: job.correlationId,
      detail: `${capped.length} findings`,
    });
    logger.info("job_completed", {
      jobId,
      type: job.analysisType,
      findings: capped.length,
      durationMs: Date.now() - new Date(job.createdAt).getTime(),
    });
  } catch (error) {
    const appError = toAppError(error);
    const latest = getJob(jobId);
    if (latest?.status === "cancelled") return;
    updateJob(jobId, {
      status: "failed",
      stage: "failed",
      errorCode: appError.code,
      errorMessage: appError.message,
      completedAt: nowIso(),
    });
    throw appError;
  }
}

async function runRepositoryAnalysis(
  job: AnalysisJobRecord,
  repositoryPath: string,
  facts: RepositoryFacts,
  question: string,
): Promise<JobOutcome> {
  const settings = getSettings();
  const staticScan = await runStaticSecurityScan(repositoryPath, {
    maxFiles: settings.limits.maxFiles,
    userExclusions: settings.exclusions,
  });

  const evidence = await gatherEvidence(repositoryPath, {
    question,
    mode: "repository",
    maxFiles: settings.limits.maxFiles,
    maxFileBytes: 262_144,
    maxContextChars: settings.limits.maxContextChars,
    userExclusions: settings.exclusions,
  });

  updateJob(job.id, { stage: "calling_model", progress: 55 });
  const provider = createModelProvider(job.id);
  const analysis = await provider.analyzeRepository({
    question,
    facts,
    evidence: evidence.files,
    staticFindings: staticScan.findings.slice(0, 10),
    truncated: evidence.truncated,
  });

  updateJob(job.id, { stage: "verifying", progress: 80 });
  const trackedAll = await collectTrackedSet(repositoryPath, settings.limits.maxFiles);
  const modelVerified = await verifyFindings(repositoryPath, trackedAll, analysis.findings, {
    maxFileBytes: 262_144,
    userExclusions: settings.exclusions,
    source: "model",
  });
  const staticVerified = await verifyFindings(repositoryPath, trackedAll, staticScan.findings, {
    maxFileBytes: 262_144,
    userExclusions: settings.exclusions,
    source: "static_rule",
  });

  return {
    summary: analysis.summary,
    findings: [...modelVerified.findings, ...staticVerified.findings],
    limitations: buildLimitations(analysis, evidence.omitted, evidence.truncated, staticScan.scannedFiles),
    extraSections: analysis.architecture
      ? [{ title: "Architecture", body: analysis.architecture }]
      : [],
    model: { provider: job.modelProvider, name: job.modelName },
  };
}

async function runCodeReview(
  job: AnalysisJobRecord,
  repositoryPath: string,
  facts: RepositoryFacts,
  input: { question: string; mode: DiffMode; range: string | null },
): Promise<JobOutcome> {
  const settings = getSettings();
  const diff = await getDiff(repositoryPath, input.mode, input.range, 200_000);

  if (diff.empty) {
    return {
      summary:
        "There are no changes to review for the selected mode. The working tree and index are empty for this selection.",
      findings: [],
      limitations: ["No diff was available, so no model review was performed."],
      extraSections: [
        {
          title: "Change set",
          body: `- Mode: ${input.mode}\n- Range: ${input.range ?? "n/a"}\n- Changed files: 0`,
        },
      ],
      review: { mode: input.mode, range: input.range, changedFiles: [] },
      model: { provider: job.modelProvider, name: job.modelName },
    };
  }

  const evidence = await gatherEvidence(repositoryPath, {
    question: input.question,
    mode: "review",
    maxFiles: settings.limits.maxFiles,
    maxFileBytes: 262_144,
    maxContextChars: settings.limits.maxContextChars,
    userExclusions: settings.exclusions,
    preferredFiles: diff.changedFiles,
  });

  updateJob(job.id, { stage: "calling_model", progress: 55 });
  const provider = createModelProvider(job.id);
  const analysis = await provider.reviewChanges({
    mode: input.mode,
    range: input.range,
    diff: diff.diff,
    changedFiles: diff.changedFiles,
    additions: diff.additions,
    deletions: diff.deletions,
    truncated: diff.truncated,
    facts,
    context: evidence.files,
  });

  updateJob(job.id, { stage: "verifying", progress: 80 });
  const trackedAll = await collectTrackedSet(repositoryPath, settings.limits.maxFiles);
  const verified = await verifyFindings(repositoryPath, trackedAll, analysis.findings, {
    maxFileBytes: 262_144,
    userExclusions: settings.exclusions,
    source: "model",
  });

  const limitations = buildLimitations(analysis, evidence.omitted, evidence.truncated, 0);
  if (diff.truncated) limitations.push("The diff was truncated at the configured size limit.");
  if (diff.changedFiles.length === 0) limitations.push("No changed files were reported by git.");

  return {
    summary: analysis.summary,
    findings: verified.findings,
    limitations,
    extraSections: [
      {
        title: "Change set",
        body: [
          `- Mode: ${input.mode}`,
          input.range ? `- Range: ${input.range}` : null,
          `- Changed files: ${diff.changedFiles.length}`,
          `- Additions/deletions: +${diff.additions}/-${diff.deletions}`,
          "",
          ...diff.changedFiles.map((file) => `- \`${file}\``),
        ]
          .filter((line) => line !== null)
          .join("\n"),
      },
      ...(analysis.architecture ? [{ title: "Architecture notes", body: analysis.architecture }] : []),
    ],
    review: { mode: input.mode, range: input.range, changedFiles: diff.changedFiles },
    model: { provider: job.modelProvider, name: job.modelName },
  };
}

async function runTestGapWorkflow(
  job: AnalysisJobRecord,
  repositoryPath: string,
  facts: RepositoryFacts,
  question: string,
): Promise<JobOutcome> {
  const settings = getSettings();
  const deterministic = await analyzeTestGaps(repositoryPath, {
    maxFiles: settings.limits.maxFiles,
    userExclusions: settings.exclusions,
  });

  const limitations = [
    "Coverage means a test file references the module name; it is not line coverage.",
    "No tests were executed. Nothing here proves behaviour is correct.",
    ...deterministic.notes,
  ];

  let analysis: ModelAnalysis | null = null;
  let modelNote: string | null = null;
  const modelConfig = resolveModelConfig();

  if (modelConfig.configured) {
    try {
      const evidence = await gatherEvidence(repositoryPath, {
        question,
        mode: "test_gaps",
        maxFiles: settings.limits.maxFiles,
        maxFileBytes: 262_144,
        maxContextChars: settings.limits.maxContextChars,
        userExclusions: settings.exclusions,
      });
      updateJob(job.id, { stage: "calling_model", progress: 55 });
      const provider = createModelProvider(job.id);
      analysis = await provider.analyzeTestGaps({
        question,
        facts,
        evidence: evidence.files,
        staticFindings: deterministic.findings.slice(0, 10),
        truncated: evidence.truncated,
      });
      if (evidence.truncated) limitations.push("Only a bounded subset of files was supplied to the model.");
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === "MODEL_NOT_CONFIGURED") {
        modelNote = appError.message;
      } else {
        throw appError;
      }
    }
  } else {
    modelNote = "No model is configured, so this report contains deterministic test-gap findings only.";
  }
  if (modelNote) limitations.unshift(modelNote);

  updateJob(job.id, { stage: "verifying", progress: 80 });
  const trackedAll = await collectTrackedSet(repositoryPath, settings.limits.maxFiles);
  const verifiedDeterministic = await verifyFindings(
    repositoryPath,
    trackedAll,
    deterministic.findings,
    { maxFileBytes: 262_144, userExclusions: settings.exclusions, source: "static_rule" },
  );
  let modelFindings: Omit<FindingRecord, "id" | "analysisJobId">[] = [];
  if (analysis) {
    const verified = await verifyFindings(repositoryPath, trackedAll, analysis.findings, {
      maxFileBytes: 262_144,
      userExclusions: settings.exclusions,
      source: "model",
    });
    modelFindings = verified.findings;
    if (analysis.limitations) limitations.push(analysis.limitations);
  }

  return {
    summary:
      analysis?.summary ??
      `Deterministic scan: ${deterministic.sourceFiles} source files and ${deterministic.testFiles} test files. ${deterministic.untestedModules} modules have no matching test reference.`,
    findings: [...verifiedDeterministic.findings, ...modelFindings],
    limitations,
    extraSections: analysis?.architecture ? [{ title: "Architecture", body: analysis.architecture }] : [],
    model: { provider: job.modelProvider, name: job.modelName },
  };
}

async function runSecurityWorkflow(
  job: AnalysisJobRecord,
  repositoryPath: string,
  facts: RepositoryFacts,
  question: string,
): Promise<JobOutcome> {
  const settings = getSettings();
  const scan = await runStaticSecurityScan(repositoryPath, {
    maxFiles: settings.limits.maxFiles,
    userExclusions: settings.exclusions,
  });

  const limitations = [
    "This is a rule-based scan, not a comprehensive security audit.",
    "A rule match is a lead for a human reviewer, not a confirmed vulnerability.",
    "No exploit was executed and no dependency scanner was run.",
  ];

  let analysis: ModelAnalysis | null = null;
  const modelConfig = resolveModelConfig();
  if (modelConfig.configured) {
    try {
      const evidence = await gatherEvidence(repositoryPath, {
        question,
        mode: "security",
        maxFiles: settings.limits.maxFiles,
        maxFileBytes: 262_144,
        maxContextChars: settings.limits.maxContextChars,
        userExclusions: settings.exclusions,
      });
      updateJob(job.id, { stage: "calling_model", progress: 55 });
      const provider = createModelProvider(job.id);
      analysis = await provider.analyzeSecurity({
        question,
        facts,
        evidence: evidence.files,
        staticFindings: scan.findings.slice(0, 15),
        truncated: evidence.truncated,
      });
      if (evidence.truncated) limitations.push("Only a bounded subset of files was supplied to the model.");
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === "MODEL_NOT_CONFIGURED") {
        limitations.unshift(appError.message);
      } else {
        throw appError;
      }
    }
  } else {
    limitations.unshift("No model is configured, so this report contains deterministic rule matches only.");
  }

  updateJob(job.id, { stage: "verifying", progress: 80 });
  const trackedAll = await collectTrackedSet(repositoryPath, settings.limits.maxFiles);
  const verifiedStatic = await verifyFindings(repositoryPath, trackedAll, scan.findings, {
    maxFileBytes: 262_144,
    userExclusions: settings.exclusions,
    source: "static_rule",
  });
  let modelFindings: Omit<FindingRecord, "id" | "analysisJobId">[] = [];
  if (analysis) {
    const verified = await verifyFindings(repositoryPath, trackedAll, analysis.findings, {
      maxFileBytes: 262_144,
      userExclusions: settings.exclusions,
      source: "model",
    });
    modelFindings = verified.findings;
    if (analysis.limitations) limitations.push(analysis.limitations);
  }

  return {
    summary:
      analysis?.summary ??
      `Rule-based scan of ${scan.scannedFiles} files produced ${scan.findings.length} leads. Each requires human confirmation.`,
    findings: [...verifiedStatic.findings, ...modelFindings],
    limitations,
    extraSections: [
      {
        title: "Scan scope",
        body: [
          `- Files scanned: ${scan.scannedFiles}`,
          `- Files skipped (unreadable or binary): ${scan.skippedFiles}`,
          `- Files with credential-like matches: ${scan.secretFileFindings}`,
          "- Rules: dynamic code execution, shell injection, SQL concatenation, unsafe HTML, TLS verification, weak hashing, permissive CORS, unsafe deserialisation, OS command execution, credential patterns.",
        ].join("\n"),
      },
      ...(analysis?.architecture ? [{ title: "Architecture", body: analysis.architecture }] : []),
    ],
    model: { provider: job.modelProvider, name: job.modelName },
  };
}

async function collectTrackedSet(repositoryPath: string, maxFiles: number): Promise<Set<string>> {
  const { listTrackedFiles } = await import("../git/git");
  const tracked = await listTrackedFiles(repositoryPath, maxFiles * 2);
  return new Set(tracked.files.map((file) => file.replace(/\\/g, "/")));
}

function buildLimitations(
  analysis: ModelAnalysis,
  omitted: number,
  truncated: boolean,
  scannedFiles: number,
): string[] {
  const limitations = [
    "Findings produced by the model are hypotheses; only deterministic inspection or an executed test can confirm them.",
    "No tests were executed as part of this analysis.",
  ];
  if (omitted > 0) limitations.push(`${omitted} files were not included in the evidence set.`);
  if (truncated) limitations.push("Some supplied files were truncated to fit the model context budget.");
  if (scannedFiles > 0) {
    limitations.push(
      `A deterministic security scan covered ${scannedFiles} files; it is a rule-based lead generator, not a full audit.`,
    );
  }
  if (analysis.limitations) limitations.push(analysis.limitations);
  if (analysis.droppedFindings > 0) {
    limitations.push(
      `${analysis.droppedFindings} model finding(s) were discarded because they did not match the required schema.`,
    );
  }
  return limitations;
}

function reportTypeFor(type: AnalysisType): "analysis" | "review" | "test_gaps" | "security" {
  switch (type) {
    case "code_review":
      return "review";
    case "test_gaps":
      return "test_gaps";
    case "security_review":
      return "security";
    default:
      return "analysis";
  }
}

export function labelFor(type: AnalysisType): string {
  switch (type) {
    case "repository_analysis":
      return "Repository analysis";
    case "code_review":
      return "Code review";
    case "test_gaps":
      return "Test gap analysis";
    case "security_review":
      return "Security review";
    case "code_search":
      return "Code search";
  }
}
