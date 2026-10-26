import { z } from "zod";
import { APP_VERSION } from "@/shared/constants";
import type { AnalysisJobRecord, RepositoryRecord } from "@/shared/types";
import { getSettings, getWorkspaceRoot, resolveModelConfig } from "../config/settings";
import {
  getJob,
  getReport,
  getReportByJobId,
  listFindings,
  listReports,
  listReportsForRepository,
} from "../db/analysis";
import { getRepository, listRepositories } from "../db/repositories";
import { AppError } from "../errors";
import { getGitStatus, listTrackedFiles } from "../git/git";
import { resolveRepositoryPath } from "../fs/pathGuard";
import { filterTrackedFiles } from "../fs/readFile";
import { buildTree } from "../fs/readFile";
import { inspectRepository } from "../inspection/overview";
import { searchCode } from "../analysis/search";
import { startAnalysis } from "../analysis/orchestrator";
import { proposePatchWorkflow, decidePatch } from "../patches/workflow";
import { createModelProvider } from "../models/provider";
import { listCommands, runCommand } from "../commands/commands";
import { activeJobCount } from "../jobs/queue";
import { snapshot } from "../observability/metrics";
import { defineTool, type ToolDefinition } from "./registry";

const repositoryId = z.string().min(3).max(200).describe("Registered repository id (repo_…)");

async function loadRepository(repositoryIdValue: string): Promise<{ repository: RepositoryRecord; repositoryPath: string }> {
  const repository = getRepository(repositoryIdValue);
  if (!repository) {
    throw new AppError("REPOSITORY_NOT_FOUND", "The selected repository is not registered.");
  }
  const workspaceRoot = await getWorkspaceRoot();
  const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
  return { repository, repositoryPath };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForJob(jobId: string, timeoutMs: number): Promise<AnalysisJobRecord> {
  const started = Date.now();
  for (;;) {
    const job = getJob(jobId);
    if (!job) throw new AppError("JOB_NOT_FOUND", "That analysis job does not exist.");
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() - started > timeoutMs) return job;
    await sleep(400);
  }
}

async function jobResult(job: AnalysisJobRecord): Promise<Record<string, unknown>> {
  const findings = listFindings(job.id);
  const report = getReportByJobId(job.id);
  return {
    job: {
      id: job.id,
      type: job.analysisType,
      status: job.status,
      summary: job.summary,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      model: job.modelName,
      correlationId: job.correlationId,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    },
    findings: findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      description: finding.description,
      filePath: finding.filePath,
      startLine: finding.startLine,
      endLine: finding.endLine,
      confidence: finding.confidence,
      evidence: finding.evidence,
      verificationStatus: finding.verificationStatus,
      source: finding.source,
      remediation: finding.remediation,
    })),
    report: report ? { id: report.id, title: report.title, type: report.reportType } : null,
    note:
      job.status === "running" || job.status === "queued"
        ? `The analysis is still running. Call get_analysis_report with jobId "${job.id}" to collect the result.`
        : null,
  };
}

const jobShape = z
  .object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    summary: z.string().nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
  })
  .passthrough();

const findingShape = z
  .object({
    id: z.string(),
    severity: z.string(),
    title: z.string(),
    filePath: z.string().nullable(),
    verificationStatus: z.string(),
  })
  .passthrough();

const analysisResultSchema = z
  .object({
    job: jobShape,
    findings: z.array(findingShape),
    report: z.object({ id: z.string(), title: z.string(), type: z.string() }).nullable(),
    note: z.string().nullable(),
  })
  .passthrough();

const WAIT_MS = 100_000;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  defineTool({
    name: "list_repositories",
    title: "List repositories",
    description:
      "List the Git repositories registered with CommitPilot. Use this first when you do not know a repository id.",
    inputSchema: z.object({}),
    outputSchema: z
      .object({
        repositories: z.array(
          z.object({ id: z.string(), name: z.string(), path: z.string() }).passthrough(),
        ),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 15_000,
    handler: async () => ({
      repositories: listRepositories().map((repository) => ({
        id: repository.id,
        name: repository.name,
        path: repository.path,
        lastCheckedAt: repository.lastCheckedAt,
      })),
    }),
  }),

  defineTool({
    name: "inspect_repository",
    title: "Inspect repository",
    description:
      "Return verified repository facts: branch, working-tree status, recent commits, languages, frameworks, test files, and (optionally) the tracked file list. Read-only and deterministic.",
    inputSchema: z.object({
      repositoryId,
      includeFiles: z.boolean().optional().default(false).describe("Include up to 300 tracked file paths"),
    }),
    outputSchema: z
      .object({
        repository: z.object({ id: z.string(), name: z.string(), path: z.string() }).passthrough(),
        overview: z.record(z.unknown()),
        status: z.record(z.unknown()),
        files: z.array(z.string()).optional(),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 45_000,
    handler: async (input) => {
      const { repository, repositoryPath } = await loadRepository(input.repositoryId);
      const settings = getSettings();
      const [overview, status] = await Promise.all([
        inspectRepository(repositoryPath, repository.name, {
          maxFiles: settings.limits.maxFiles,
          userExclusions: settings.exclusions,
        }),
        getGitStatus(repositoryPath),
      ]);
      let files: string[] | undefined;
      if (input.includeFiles) {
        const tracked = await listTrackedFiles(repositoryPath, settings.limits.maxFiles);
        const filtered = filterTrackedFiles(tracked.files, {
          maxFiles: 300,
          userExclusions: settings.exclusions,
        });
        files = filtered.files;
      }
      return {
        repository: { id: repository.id, name: repository.name, path: repository.path },
        overview,
        status,
        ...(files ? { files, tree: buildTree(files).slice(0, 400) } : {}),
      };
    },
  }),

  defineTool({
    name: "analyze_repository",
    title: "Analyze repository",
    description:
      "Run an AI repository analysis using the configured open model and real repository evidence. Returns a summary, findings with verification status, and a saved report. Takes up to two minutes.",
    inputSchema: z.object({
      repositoryId,
      question: z
        .string()
        .min(3)
        .max(2000)
        .optional()
        .describe("What to analyse, e.g. 'explain the architecture and find likely bugs'"),
      wait: z.boolean().optional().default(true).describe("Wait for completion instead of returning a job id"),
    }),
    outputSchema: analysisResultSchema,
    risk: "read",
    timeoutMs: 180_000,
    annotations: { openWorldHint: true },
    handler: async (input) => {
      const { repository } = await loadRepository(input.repositoryId);
      const job = await startAnalysis({
        repositoryId: repository.id,
        type: "repository_analysis",
        question: input.question,
      });
      const finalJob = input.wait ? await waitForJob(job.id, WAIT_MS) : job;
      return jobResult(finalJob);
    },
  }),

  defineTool({
    name: "review_git_changes",
    title: "Review Git changes",
    description:
      "Review real uncommitted Git changes (unstaged, staged, both, or a commit range) with the open model. Findings reference changed lines or are labelled as contextual.",
    inputSchema: z.object({
      repositoryId,
      mode: z.enum(["unstaged", "staged", "both", "commit_range"]).optional().default("both"),
      range: z.string().max(200).optional().describe("Commit range, required when mode is commit_range"),
      question: z.string().min(3).max(2000).optional(),
      wait: z.boolean().optional().default(true),
    }),
    outputSchema: analysisResultSchema,
    risk: "read",
    timeoutMs: 180_000,
    annotations: { openWorldHint: true },
    handler: async (input) => {
      const { repository } = await loadRepository(input.repositoryId);
      const job = await startAnalysis({
        repositoryId: repository.id,
        type: "code_review",
        question: input.question,
        diffMode: input.mode,
        range: input.range ?? null,
      });
      const finalJob = input.wait ? await waitForJob(job.id, WAIT_MS) : job;
      return jobResult(finalJob);
    },
  }),

  defineTool({
    name: "search_code",
    title: "Search code",
    description:
      "Find code using a natural-language or symbol query. Returns real file/line matches from tracked, non-excluded files, plus an optional model-written summary grounded in those matches.",
    inputSchema: z.object({
      repositoryId,
      query: z.string().min(2).max(300),
      summarize: z.boolean().optional().default(true),
    }),
    outputSchema: z
      .object({
        query: z.string(),
        files: z.array(z.object({ path: z.string(), matches: z.number() }).passthrough()),
        matches: z.array(z.object({ path: z.string(), line: z.number() }).passthrough()),
        modelSummary: z.object({ answer: z.string(), files: z.array(z.string()) }).nullable(),
        modelError: z.string().nullable(),
        message: z.string().nullable(),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 90_000,
    annotations: { openWorldHint: true },
    handler: async (input) => {
      const { repositoryPath } = await loadRepository(input.repositoryId);
      const settings = getSettings();
      const result = await searchCode(repositoryPath, input.query, {
        maxFiles: settings.limits.maxFiles,
        userExclusions: settings.exclusions,
      });

      let modelSummary: { answer: string; files: string[] } | null = null;
      let modelError: string | null = null;
      const modelConfig = resolveModelConfig();
      if (input.summarize && result.matches.length > 0 && modelConfig.configured) {
        try {
          const provider = createModelProvider(null);
          modelSummary = await provider.summarizeSearch({
            question: input.query,
            results: result.matches.map((match) => ({
              path: match.path,
              line: match.line,
              snippet: match.snippet,
            })),
          });
        } catch (error) {
          modelError =
            error instanceof AppError
              ? error.message
              : "The model summary was unavailable; deterministic results are shown.";
        }
      }
      return { ...result, modelSummary, modelError };
    },
  }),

  defineTool({
    name: "analyze_test_gaps",
    title: "Analyze test gaps",
    description:
      "Identify modules with no matching test reference, plus model-reviewed coverage risks. Coverage here means a test references the module; no tests are executed.",
    inputSchema: z.object({
      repositoryId,
      question: z.string().min(3).max(2000).optional(),
      wait: z.boolean().optional().default(true),
    }),
    outputSchema: analysisResultSchema,
    risk: "read",
    timeoutMs: 180_000,
    annotations: { openWorldHint: true },
    handler: async (input) => {
      const { repository } = await loadRepository(input.repositoryId);
      const job = await startAnalysis({
        repositoryId: repository.id,
        type: "test_gaps",
        question: input.question,
      });
      const finalJob = input.wait ? await waitForJob(job.id, WAIT_MS) : job;
      return jobResult(finalJob);
    },
  }),

  defineTool({
    name: "review_security",
    title: "Review security",
    description:
      "Run deterministic security rules over tracked source and optionally have the open model assess the leads. Rule matches are not confirmed vulnerabilities.",
    inputSchema: z.object({
      repositoryId,
      question: z.string().min(3).max(2000).optional(),
      wait: z.boolean().optional().default(true),
    }),
    outputSchema: analysisResultSchema,
    risk: "read",
    timeoutMs: 180_000,
    annotations: { openWorldHint: true },
    handler: async (input) => {
      const { repository } = await loadRepository(input.repositoryId);
      const job = await startAnalysis({
        repositoryId: repository.id,
        type: "security_review",
        question: input.question,
      });
      const finalJob = input.wait ? await waitForJob(job.id, WAIT_MS) : job;
      return jobResult(finalJob);
    },
  }),

  defineTool({
    name: "propose_patch",
    title: "Propose patch",
    description:
      "Ask the open model for a minimal unified diff against real files, then validate it with git apply --check. Nothing is written to the repository.",
    inputSchema: z.object({
      repositoryId,
      request: z.string().min(5).max(2000).describe("What the patch should change"),
      filePaths: z.array(z.string().min(1).max(400)).max(5).optional(),
      findingId: z.string().min(3).max(200).optional().describe("Anchor the patch to an existing finding"),
    }),
    outputSchema: z
      .object({
        patch: z
          .object({
            id: z.string(),
            title: z.string(),
            status: z.string(),
            patchText: z.string(),
            files: z.array(z.string()),
          })
          .passthrough(),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 180_000,
    annotations: { openWorldHint: true },
    handler: async (input) => {
      const patch = await proposePatchWorkflow({
        repositoryId: input.repositoryId,
        request: input.request,
        filePaths: input.filePaths,
        findingId: input.findingId,
      });
      return { patch };
    },
  }),

  defineTool({
    name: "apply_patch",
    title: "Apply or reject patch",
    description:
      "Explicitly approve or reject a proposed patch. Applying re-validates the diff, backs up touched files, and requires both confirm:true and the server-side apply flag.",
    inputSchema: z.object({
      patchId: z.string().min(3).max(200),
      approve: z.boolean(),
      confirm: z.boolean().describe("Must be true; the user must have approved this action"),
    }),
    outputSchema: z
      .object({
        patch: z.object({ id: z.string(), status: z.string() }).passthrough(),
        changedFiles: z.array(z.string()),
        backupDirectory: z.string().nullable(),
      })
      .passthrough(),
    risk: "write",
    sideEffects: true,
    requiresConfirmation: true,
    timeoutMs: 60_000,
    handler: async (input) => decidePatch({ patchId: input.patchId, approve: input.approve }),
  }),

  defineTool({
    name: "get_analysis_report",
    title: "Get analysis report",
    description:
      "Fetch a saved analysis report and its findings by jobId or reportId. Use the jobId returned by an analysis tool that is still running.",
    inputSchema: z.object({
      jobId: z.string().min(3).max(200).optional(),
      reportId: z.string().min(3).max(200).optional(),
    }),
    outputSchema: z
      .object({
        job: jobShape.nullable(),
        findings: z.array(findingShape),
        report: z
          .object({ id: z.string(), title: z.string(), markdown: z.string() })
          .passthrough()
          .nullable(),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 20_000,
    handler: async (input) => {
      if (!input.jobId && !input.reportId) {
        throw new AppError("INVALID_ARGUMENTS", "Provide a jobId or a reportId.");
      }
      if (input.reportId) {
        const report = getReport(input.reportId);
        if (!report) throw new AppError("REPORT_NOT_FOUND", "That report does not exist.");
        const job = report.jobId ? getJob(report.jobId) : null;
        return {
          job: job ? await jobResult(job).then((result) => result.job) : null,
          findings: job ? listFindings(job.id) : [],
          report: {
            id: report.id,
            title: report.title,
            type: report.reportType,
            createdAt: report.createdAt,
            markdown: report.markdown,
            json: report.json,
          },
        };
      }
      const job = getJob(input.jobId as string);
      if (!job) throw new AppError("JOB_NOT_FOUND", "That analysis job does not exist.");
      const report = getReportByJobId(job.id);
      return {
        job: (await jobResult(job)).job,
        findings: listFindings(job.id),
        report: report
          ? {
              id: report.id,
              title: report.title,
              type: report.reportType,
              createdAt: report.createdAt,
              markdown: report.markdown,
              json: report.json,
            }
          : null,
      };
    },
  }),

  defineTool({
    name: "list_reports",
    title: "List reports",
    description: "List saved analysis reports for a repository (or all repositories).",
    inputSchema: z.object({
      repositoryId: z.string().min(3).max(200).optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    }),
    outputSchema: z
      .object({
        reports: z.array(
          z.object({ id: z.string(), title: z.string(), type: z.string() }).passthrough(),
        ),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 15_000,
    handler: async (input) => {
      const reports = input.repositoryId
        ? listReportsForRepository(input.repositoryId, input.limit)
        : listReports(input.limit);
      return {
        reports: reports.map((report) => ({
          id: report.id,
          title: report.title,
          type: report.reportType,
          repositoryId: report.repositoryId,
          createdAt: report.createdAt,
        })),
      };
    },
  }),

  defineTool({
    name: "list_validation_commands",
    title: "List validation commands",
    description:
      "List the allowlisted validation commands for a repository and whether each is available. No command is executed.",
    inputSchema: z.object({ repositoryId }),
    outputSchema: z
      .object({
        enabled: z.boolean(),
        commands: z.array(z.object({ id: z.string(), available: z.boolean() }).passthrough()),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 20_000,
    handler: async (input) => {
      const { repositoryPath } = await loadRepository(input.repositoryId);
      const settings = getSettings();
      const config = resolveModelConfig();
      return {
        enabled: settings.commandExecution.enabled,
        modelConfigured: config.configured,
        commands: await listCommands(repositoryPath),
      };
    },
  }),

  defineTool({
    name: "run_validation_command",
    title: "Run validation command",
    description:
      "Run one allowlisted validation command (for example npm test) in the repository. Requires explicit confirmation and both server-side enable flags. Output is redacted and size-limited.",
    inputSchema: z.object({
      repositoryId,
      commandId: z.string().min(3).max(80),
      confirm: z.boolean().describe("Must be true; the user must have approved this run"),
    }),
    outputSchema: z
      .object({
        commandId: z.string(),
        exitCode: z.number().nullable(),
        timedOut: z.boolean(),
        stdout: z.string(),
        stderr: z.string(),
      })
      .passthrough(),
    risk: "write",
    sideEffects: true,
    requiresConfirmation: true,
    timeoutMs: 300_000,
    handler: async (input) => {
      const { repositoryPath } = await loadRepository(input.repositoryId);
      return runCommand(repositoryPath, input.commandId, { confirm: input.confirm });
    },
  }),

  defineTool({
    name: "get_health",
    title: "Get health",
    description:
      "Report application health separately from open-model provider availability, plus tool counters.",
    inputSchema: z.object({}),
    outputSchema: z
      .object({
        app: z.string(),
        version: z.string(),
        model: z.object({ configured: z.boolean() }).passthrough(),
      })
      .passthrough(),
    risk: "read",
    timeoutMs: 15_000,
    handler: async () => {
      const config = resolveModelConfig();
      return {
        app: "ok",
        version: APP_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        activeJobs: activeJobCount(),
        model: {
          configured: config.configured,
          provider: config.providerLabel,
          name: config.model,
          hosted: config.hosted,
          privacyBlocked: config.privacyBlocked,
        },
        metrics: snapshot(),
      };
    },
  }),
];
