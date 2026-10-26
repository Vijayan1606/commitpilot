import type { FindingCategory, Severity } from "@/shared/constants";

export interface EvidenceFile {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  redactions: number;
}

export interface RepositoryFacts {
  name: string;
  branch: string | null;
  isDirty: boolean;
  fileCount: number;
  languages: { language: string; files: number; percent: number }[];
  frameworks: string[];
  packageManager: string | null;
  manifests: string[];
  testFileCount: number;
  sourceFileCount: number;
  recentCommits: { shortHash: string; subject: string }[];
}

export interface AnalysisInput {
  question: string;
  facts: RepositoryFacts;
  evidence: EvidenceFile[];
  /** Deterministic findings that already have verified evidence. */
  staticFindings?: ModelFinding[];
  truncated: boolean;
}

export interface DiffInput {
  mode: string;
  range: string | null;
  diff: string;
  changedFiles: string[];
  additions: number;
  deletions: number;
  truncated: boolean;
  facts: RepositoryFacts;
  context: EvidenceFile[];
}

export interface ModelFinding {
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  evidence: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  confidence: "high" | "medium" | "low";
  remediation: string;
}

export interface ModelAnalysis {
  summary: string;
  architecture: string | null;
  findings: ModelFinding[];
  nextSteps: string[];
  limitations: string | null;
  droppedFindings: number;
  rawFindingCount: number;
}

export interface PatchProposalInput {
  request: string;
  facts: RepositoryFacts;
  targetFiles: EvidenceFile[];
  staticFindings?: ModelFinding[];
}

export interface ModelPatch {
  title: string;
  rationale: string;
  files: string[];
  unifiedDiff: string;
  notes: string | null;
}

export interface SearchSummaryInput {
  question: string;
  results: { path: string; line: number; snippet: string }[];
}

export interface ModelSearchSummary {
  answer: string;
  files: string[];
}

export interface OpenModelProvider {
  analyzeRepository(input: AnalysisInput): Promise<ModelAnalysis>;
  reviewChanges(input: DiffInput): Promise<ModelAnalysis>;
  generateImprovementPlan(input: AnalysisInput): Promise<ModelAnalysis>;
  analyzeTestGaps(input: AnalysisInput): Promise<ModelAnalysis>;
  analyzeSecurity(input: AnalysisInput): Promise<ModelAnalysis>;
  proposePatch(input: PatchProposalInput): Promise<ModelPatch>;
  summarizeSearch(input: SearchSummaryInput): Promise<ModelSearchSummary>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}
