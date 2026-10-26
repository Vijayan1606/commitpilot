import { APP_NAME, APP_VERSION, SEVERITIES, type Severity } from "@/shared/constants";
import type {
  AnalysisJobRecord,
  FindingRecord,
  PatchRecord,
  RepositoryRecord,
  ReviewRecord,
} from "@/shared/types";

export interface ReportMeta {
  repository: RepositoryRecord;
  job: AnalysisJobRecord | null;
  overview: {
    branch: string | null;
    headCommit: string | null;
    isDirty: boolean;
    fileCount: number;
    languages: { language: string; percent: number }[];
    frameworks: string[];
    packageManager: string | null;
    testFileCount: number;
  };
  findings: FindingRecord[];
  model: { provider: string | null; name: string | null };
  limitations: string[];
  extraSections?: { title: string; body: string }[];
}

const VERIFICATION_LABELS: Record<string, string> = {
  static_rule_match: "Static rule match (needs human confirmation)",
  path_verified_model_hypothesis: "AI hypothesis; cited file exists",
  unverified_model_hypothesis: "AI hypothesis; not verified",
  needs_manual_verification: "Needs manual verification",
  verified_by_test: "Verified by executed test",
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function severitySummary(findings: FindingRecord[]): string {
  return SEVERITIES.map((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length;
    return `${severity}: ${count}`;
  }).join(" · ");
}

export function renderAnalysisMarkdown(meta: ReportMeta): string {
  const { repository, job, overview, findings, model } = meta;
  const lines: string[] = [];
  const date = job?.completedAt ?? new Date().toISOString();

  lines.push(`# ${job?.analysisType === "code_review" ? "Code review" : "Repository analysis"}: ${repository.name}`);
  lines.push("");
  lines.push(`- **Repository:** \`${repository.name}\``);
  lines.push(`- **Branch:** ${overview.branch ?? "unknown"}`);
  lines.push(`- **Commit:** ${overview.headCommit?.slice(0, 12) ?? "no commits"}`);
  lines.push(`- **Working tree:** ${overview.isDirty ? "has uncommitted changes" : "clean"}`);
  lines.push(`- **Analysed at:** ${date}`);
  lines.push(`- **Tool:** ${APP_NAME} ${APP_VERSION}`);
  lines.push(
    `- **Model:** ${model.name ?? "not configured"}${model.provider ? ` (\`${model.provider}\`)` : ""}`,
  );
  lines.push(`- **Findings:** ${findings.length} — ${severitySummary(findings)}`);
  lines.push("");

  if (job?.summary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(job.summary.trim());
    lines.push("");
  }

  lines.push("## Repository overview");
  lines.push("");
  lines.push(`- Files analysed: ${overview.fileCount}`);
  lines.push(`- Languages: ${overview.languages.map((entry) => `${entry.language} ${entry.percent}%`).join(", ") || "unknown"}`);
  lines.push(`- Frameworks: ${overview.frameworks.join(", ") || "none detected"}`);
  lines.push(`- Package manager: ${overview.packageManager ?? "unknown"}`);
  lines.push(`- Test files detected: ${overview.testFileCount}`);
  lines.push("");

  if (findings.length === 0) {
    lines.push("## Findings");
    lines.push("");
    lines.push("No findings were reported for the supplied evidence. This is not proof that the code is correct.");
    lines.push("");
  } else {
    lines.push("## Findings");
    lines.push("");
    lines.push("| # | Severity | Category | Title | Location | Verification |");
    lines.push("| - | -------- | -------- | ----- | -------- | ------------ |");
    findings.forEach((finding, index) => {
      const location = finding.filePath
        ? `${finding.filePath}${finding.startLine ? `:${finding.startLine}` : ""}`
        : "no file reference";
      lines.push(
        `| ${index + 1} | ${finding.severity} | ${finding.category} | ${escapeCell(finding.title)} | ${escapeCell(location)} | ${escapeCell(VERIFICATION_LABELS[finding.verificationStatus] ?? finding.verificationStatus)} |`,
      );
    });
    lines.push("");

    findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. [${finding.severity.toUpperCase()}] ${finding.title}`);
      lines.push("");
      lines.push(finding.description);
      lines.push("");
      if (finding.filePath) {
        lines.push(`**Location:** \`${finding.filePath}${finding.startLine ? `:${finding.startLine}${finding.endLine && finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}` : ""}\``);
        lines.push("");
      }
      if (finding.evidence) {
        lines.push("**Evidence:**");
        lines.push("");
        lines.push("```text");
        lines.push(finding.evidence);
        lines.push("```");
        lines.push("");
      }
      lines.push(`**Confidence:** ${finding.confidence}`);
      lines.push("");
      lines.push(`**Verification:** ${VERIFICATION_LABELS[finding.verificationStatus] ?? finding.verificationStatus}`);
      lines.push("");
      if (finding.remediation) {
        lines.push("**Suggested remediation:**");
        lines.push("");
        lines.push(finding.remediation);
        lines.push("");
      }
    });
  }

  for (const section of meta.extraSections ?? []) {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.body.trim());
    lines.push("");
  }

  lines.push("## Verification legend");
  lines.push("");
  for (const [key, label] of Object.entries(VERIFICATION_LABELS)) {
    lines.push(`- \`${key}\` — ${label}`);
  }
  lines.push("");
  lines.push("A finding is never marked verified because a model suggested it. Only deterministic inspection or an executed test can raise verification.");
  lines.push("");

  lines.push("## Limitations");
  lines.push("");
  for (const limitation of meta.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push("");

  lines.push("## Privacy");
  lines.push("");
  lines.push(
    "Only tracked, non-excluded files were considered. Credential-like paths (.env, keys, credential files) are excluded before content is read. Detected secrets are redacted before any content is sent to the configured model. Review `docs/data-privacy.md` for the full data flow.",
  );
  lines.push("");

  return lines.join("\n");
}

export function buildAnalysisJson(meta: ReportMeta): string {
  return JSON.stringify(
    {
      tool: { name: APP_NAME, version: APP_VERSION },
      repository: {
        id: meta.repository.id,
        name: meta.repository.name,
        branch: meta.overview.branch,
        commit: meta.overview.headCommit,
        workingTreeDirty: meta.overview.isDirty,
      },
      analysis: meta.job
        ? {
            id: meta.job.id,
            type: meta.job.analysisType,
            status: meta.job.status,
            startedAt: meta.job.startedAt,
            completedAt: meta.job.completedAt,
            correlationId: meta.job.correlationId,
          }
        : null,
      model: meta.model,
      overview: meta.overview,
      findings: meta.findings,
      limitations: meta.limitations,
    },
    null,
    2,
  );
}

export function renderReviewMarkdown(meta: ReportMeta, review: ReviewRecord | null): string {
  const sections = [...(meta.extraSections ?? [])];
  if (review) {
    sections.unshift({
      title: "Change set",
      body: [
        `- Mode: ${review.mode}`,
        review.range ? `- Range: ${review.range}` : null,
        `- Changed files: ${review.changedFiles.length}`,
        ...review.changedFiles.map((file) => `  - \`${file}\``),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  return renderAnalysisMarkdown({ ...meta, extraSections: sections });
}

export function renderPatchMarkdown(patch: PatchRecord, repository: RepositoryRecord): string {
  return [
    `# Patch proposal: ${patch.title}`,
    "",
    `- **Repository:** \`${repository.name}\``,
    `- **Created:** ${patch.createdAt}`,
    `- **Status:** ${patch.status}`,
    `- **Files:** ${patch.files.map((file) => `\`${file}\``).join(", ") || "none"}`,
    `- **Applies cleanly:** ${patch.validation.appliesCleanly ? "yes" : "no"}`,
    "",
    "## Rationale",
    "",
    patch.rationale,
    "",
    "## Proposed diff",
    "",
    "```diff",
    patch.patchText,
    "```",
    "",
    "## Validation",
    "",
    patch.validation.ok
      ? "The diff was validated against the repository and applies cleanly."
      : `The diff was rejected: ${patch.validation.errors.join("; ")}`,
    "",
    "No file is modified until the patch is approved explicitly.",
    "",
  ].join("\n");
}

export function sanitizeFilename(input: string): string {
  return (
    input
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "commitpilot-report"
  );
}

export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
