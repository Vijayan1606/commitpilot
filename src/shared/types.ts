import type {
  AnalysisType,
  FindingCategory,
  Severity,
  VerificationStatus,
} from "./constants";

export interface RepositoryRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
}

export interface FindingRecord {
  id: string;
  analysisJobId: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  confidence: "high" | "medium" | "low";
  evidence: string;
  verificationStatus: VerificationStatus;
  source: "model" | "static_rule" | "deterministic";
  remediation: string;
}

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AnalysisJobRecord {
  id: string;
  repositoryId: string;
  analysisType: AnalysisType;
  status: JobStatus;
  stage: string | null;
  progress: number;
  request: string | null;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  modelProvider: string | null;
  modelName: string | null;
  correlationId: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface PatchRecord {
  id: string;
  repositoryId: string;
  jobId: string | null;
  title: string;
  rationale: string;
  patchText: string;
  files: string[];
  status: "proposed" | "applied" | "rejected" | "invalid";
  validation: PatchValidation;
  createdAt: string;
  appliedAt: string | null;
}

export interface PatchValidation {
  ok: boolean;
  checkedAt: string;
  errors: string[];
  filesTouched: string[];
  appliesCleanly: boolean;
  diffStat: string | null;
}

export interface ReviewRecord {
  id: string;
  repositoryId: string;
  jobId: string;
  mode: "unstaged" | "staged" | "both" | "commit_range";
  range: string | null;
  changedFiles: string[];
  summary: string | null;
  createdAt: string;
}

export interface ReportRecord {
  id: string;
  repositoryId: string;
  jobId: string | null;
  reportType: "analysis" | "review" | "test_gaps" | "security" | "search";
  title: string;
  markdown: string;
  json: string;
  createdAt: string;
}

export interface OperationRecord {
  id: string;
  repositoryId: string | null;
  operationType: string;
  outcome: "success" | "failure" | "rejected";
  correlationId: string;
  detail: string | null;
  createdAt: string;
}

export interface ModelInfo {
  provider: string;
  model: string;
  baseUrlHost: string;
  configured: boolean;
  licenseNote: string;
}

export interface RepositoryOverview {
  name: string;
  path: string;
  branch: string | null;
  headCommit: string | null;
  isDirty: boolean;
  changedFiles: number;
  untrackedFiles: number;
  fileCount: number;
  languages: { language: string; files: number; percent: number }[];
  packageManager: string | null;
  frameworks: string[];
  manifests: string[];
  testDirectories: string[];
  testFileCount: number;
  sourceFileCount: number;
  truncated: boolean;
  scannedAt: string;
}

export interface StructuredError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
