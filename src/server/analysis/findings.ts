import { SEVERITY_RANK, type Severity } from "@/shared/constants";
import type { FindingRecord } from "@/shared/types";
import type { ModelFinding } from "../models/types";
import { readRepositoryFile } from "../fs/readFile";
import { redactSecrets } from "../observability/redact";

export interface VerificationResult {
  findings: Omit<FindingRecord, "id" | "analysisJobId">[];
  invalidPaths: number;
  invalidLines: number;
  duplicatesRemoved: number;
}

/**
 * Attach deterministic verification metadata to model findings. A model claim
 * never becomes "verified": the best outcome is that its cited path exists.
 */
export async function verifyFindings(
  repositoryRoot: string,
  trackedFiles: Set<string>,
  findings: ModelFinding[],
  options: { maxFileBytes: number; userExclusions: string[]; source: "model" | "static_rule" },
): Promise<VerificationResult> {
  const lineCache = new Map<string, number | null>();
  let invalidPaths = 0;
  let invalidLines = 0;

  const seen = new Set<string>();
  const deduped: ModelFinding[] = [];
  let duplicatesRemoved = 0;
  for (const finding of findings) {
    const key = `${finding.filePath ?? ""}::${finding.title.toLowerCase()}::${finding.startLine ?? ""}`;
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);
    deduped.push(finding);
  }

  const output: Omit<FindingRecord, "id" | "analysisJobId">[] = [];

  for (const finding of deduped) {
    let filePath = finding.filePath;
    let startLine = finding.startLine;
    let endLine = finding.endLine;
    let verificationStatus: FindingRecord["verificationStatus"] =
      options.source === "static_rule" ? "static_rule_match" : "unverified_model_hypothesis";

    if (filePath) {
      if (!trackedFiles.has(filePath)) {
        invalidPaths += 1;
        filePath = null;
        startLine = null;
        endLine = null;
        verificationStatus = "unverified_model_hypothesis";
      } else {
        verificationStatus = "path_verified_model_hypothesis";
        if (startLine !== null) {
          let lineCount = lineCache.get(filePath) ?? null;
          if (!lineCache.has(filePath)) {
            try {
              const file = await readRepositoryFile(repositoryRoot, filePath, {
                maxBytes: options.maxFileBytes,
                userExclusions: options.userExclusions,
                maxLines: 20_000,
              });
              lineCount = file.lineCount;
            } catch {
              lineCount = null;
            }
            lineCache.set(filePath, lineCount);
          }
          if (lineCount === null || startLine > lineCount) {
            invalidLines += 1;
            startLine = null;
            endLine = null;
            verificationStatus = "needs_manual_verification";
          } else if (endLine !== null && endLine > lineCount) {
            endLine = lineCount;
          }
        }
      }
    }

    if (options.source === "static_rule") {
      verificationStatus = "static_rule_match";
    }

    output.push({
      category: finding.category,
      severity: finding.severity,
      title: redactSecrets(finding.title),
      description: redactSecrets(finding.description),
      filePath,
      startLine,
      endLine,
      confidence: finding.confidence,
      evidence: redactSecrets(finding.evidence),
      verificationStatus,
      source: options.source,
      remediation: redactSecrets(finding.remediation),
    });
  }

  output.sort((a, b) => SEVERITY_RANK[a.severity as Severity] - SEVERITY_RANK[b.severity as Severity]);
  return { findings: output, invalidPaths, invalidLines, duplicatesRemoved };
}
