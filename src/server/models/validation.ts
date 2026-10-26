import { z } from "zod";
import {
  FINDING_CATEGORIES,
  SEVERITIES,
  type FindingCategory,
  type Severity,
} from "@/shared/constants";
import type { ModelAnalysis, ModelFinding } from "./types";

const SEVERITY_ALIASES: Record<string, Severity> = {
  critical: "critical",
  blocker: "critical",
  severe: "critical",
  high: "high",
  error: "high",
  major: "high",
  medium: "medium",
  moderate: "medium",
  warning: "medium",
  warn: "medium",
  low: "low",
  minor: "low",
  info: "info",
  informational: "info",
  note: "info",
  suggestion: "info",
};

const CATEGORY_ALIASES: Record<string, FindingCategory> = {
  correctness: "correctness",
  bug: "correctness",
  bugs: "correctness",
  logic: "correctness",
  security: "security",
  vulnerability: "security",
  performance: "performance",
  maintainability: "maintainability",
  quality: "maintainability",
  style: "maintainability",
  testing: "testing",
  tests: "testing",
  test: "testing",
  architecture: "architecture",
  design: "architecture",
  data: "data",
  database: "data",
  other: "other",
};

function normalizeSeverity(value: unknown): Severity {
  const key = String(value ?? "").trim().toLowerCase();
  return SEVERITY_ALIASES[key] ?? "medium";
}

function normalizeCategory(value: unknown): FindingCategory {
  const key = String(value ?? "").trim().toLowerCase();
  return CATEGORY_ALIASES[key] ?? "other";
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "high" || key === "medium" || key === "low") return key;
  return "low";
}

function normalizeLine(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5_000_000) return null;
  return Math.trunc(parsed);
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed) || trimmed.includes("..")) return null;
  if (trimmed.length > 500) return null;
  return trimmed;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

const RawFindingSchema = z.object({
  category: z.unknown().optional(),
  severity: z.unknown().optional(),
  title: z.unknown().optional(),
  description: z.unknown().optional(),
  explanation: z.unknown().optional(),
  evidence: z.unknown().optional(),
  filePath: z.unknown().optional(),
  path: z.unknown().optional(),
  startLine: z.unknown().optional(),
  endLine: z.unknown().optional(),
  line: z.unknown().optional(),
  confidence: z.unknown().optional(),
  remediation: z.unknown().optional(),
  suggestion: z.unknown().optional(),
  fix: z.unknown().optional(),
});

const RawAnalysisSchema = z.object({
  summary: z.unknown().optional(),
  architecture: z.unknown().optional(),
  findings: z.unknown().optional(),
  issues: z.unknown().optional(),
  nextSteps: z.unknown().optional(),
  recommendedNextSteps: z.unknown().optional(),
  limitations: z.unknown().optional(),
});

export function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const withoutOpen = trimmed.replace(/^```(?:json|JSON)?\s*/, "");
    const withoutClose = withoutOpen.replace(/```\s*$/, "");
    return withoutClose.trim();
  }
  return trimmed;
}

export function extractJsonObject(raw: string): unknown {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in the model response.");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export function parseFinding(raw: unknown): ModelFinding | null {
  const parsed = RawFindingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  const title = text(value.title, 200);
  const description = text(value.description ?? value.explanation, 4000);
  if (!title || !description) return null;

  const startLine = normalizeLine(value.startLine ?? value.line);
  const endLine = normalizeLine(value.endLine);
  return {
    category: normalizeCategory(value.category),
    severity: normalizeSeverity(value.severity),
    title,
    description,
    evidence: text(value.evidence, 2000),
    filePath: normalizePath(value.filePath ?? value.path),
    startLine,
    endLine: endLine && startLine && endLine >= startLine ? endLine : startLine,
    confidence: normalizeConfidence(value.confidence),
    remediation: text(value.remediation ?? value.suggestion ?? value.fix, 2000),
  };
}

export function parseAnalysis(raw: unknown): ModelAnalysis {
  const parsed = RawAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The model response was not an object.");
  }
  const value = parsed.data;
  const rawFindings = value.findings ?? value.issues;
  if (!Array.isArray(rawFindings)) {
    throw new Error("The model response did not contain a findings array.");
  }
  if (rawFindings.length > 200) {
    throw new Error("The model returned an unreasonable number of findings.");
  }

  const findings: ModelFinding[] = [];
  for (const candidate of rawFindings) {
    const finding = parseFinding(candidate);
    if (finding) findings.push(finding);
  }

  const dropped = rawFindings.length - findings.length;
  if (rawFindings.length > 0 && findings.length === 0) {
    throw new Error("Every finding in the model response was malformed.");
  }

  const nextStepsRaw = value.nextSteps ?? value.recommendedNextSteps;
  const nextSteps = Array.isArray(nextStepsRaw)
    ? nextStepsRaw.map((step) => text(step, 300)).filter(Boolean).slice(0, 12)
    : [];

  const summary = text(value.summary, 6000);
  if (!summary) {
    throw new Error("The model response did not include a summary.");
  }

  return {
    summary,
    architecture: text(value.architecture, 6000) || null,
    findings: findings.slice(0, 40),
    nextSteps,
    limitations: text(value.limitations, 2000) || null,
    droppedFindings: dropped,
    rawFindingCount: rawFindings.length,
  };
}

const SEVERITY_SET = new Set<string>(SEVERITIES);
const CATEGORY_SET = new Set<string>(FINDING_CATEGORIES);

export function isKnownSeverity(value: string): boolean {
  return SEVERITY_SET.has(value);
}

export function isKnownCategory(value: string): boolean {
  return CATEGORY_SET.has(value);
}
