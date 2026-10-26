import { getDb, withTransaction } from "./client";
import { newId, nowIso } from "../observability/ids";
import { SEVERITY_RANK, type AnalysisType, type Severity } from "@/shared/constants";
import type {
  AnalysisJobRecord,
  FindingRecord,
  PatchRecord,
  PatchValidation,
  ReportRecord,
  ReviewRecord,
} from "@/shared/types";

type Row = Record<string, unknown>;

function toJob(row: Row): AnalysisJobRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    analysisType: String(row.analysis_type) as AnalysisType,
    status: String(row.status) as AnalysisJobRecord["status"],
    stage: row.stage ? String(row.stage) : null,
    progress: Number(row.progress ?? 0),
    request: row.request ? String(row.request) : null,
    summary: row.summary ? String(row.summary) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    modelProvider: row.model_provider ? String(row.model_provider) : null,
    modelName: row.model_name ? String(row.model_name) : null,
    correlationId: String(row.correlation_id),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
  };
}

function toFinding(row: Row): FindingRecord {
  return {
    id: String(row.id),
    analysisJobId: String(row.analysis_job_id),
    category: String(row.category) as FindingRecord["category"],
    severity: String(row.severity) as Severity,
    title: String(row.title),
    description: String(row.description),
    filePath: row.file_path ? String(row.file_path) : null,
    startLine: row.start_line === null || row.start_line === undefined ? null : Number(row.start_line),
    endLine: row.end_line === null || row.end_line === undefined ? null : Number(row.end_line),
    confidence: String(row.confidence) as FindingRecord["confidence"],
    evidence: String(row.evidence),
    verificationStatus: String(row.verification_status) as FindingRecord["verificationStatus"],
    source: String(row.source) as FindingRecord["source"],
    remediation: String(row.remediation),
  };
}

export function createJob(input: {
  repositoryId: string;
  analysisType: AnalysisType;
  request: string | null;
  correlationId: string;
  modelProvider: string | null;
  modelName: string | null;
}): AnalysisJobRecord {
  const id = newId("job");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO analysis_jobs
        (id, repository_id, analysis_type, status, stage, progress, request, correlation_id,
         model_provider, model_name, created_at)
       VALUES (?, ?, ?, 'queued', 'queued', 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.repositoryId,
      input.analysisType,
      input.request,
      input.correlationId,
      input.modelProvider,
      input.modelName,
      now,
    );
  return getJob(id) as AnalysisJobRecord;
}

export function getJob(id: string): AnalysisJobRecord | null {
  const row = getDb().prepare("SELECT * FROM analysis_jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? toJob(row) : null;
}

export function listJobs(limit = 50): AnalysisJobRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM analysis_jobs ORDER BY created_at DESC LIMIT ?")
    .all(Math.min(limit, 200)) as Row[];
  return rows.map(toJob);
}

export function listJobsForRepository(repositoryId: string, limit = 50): AnalysisJobRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM analysis_jobs WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(repositoryId, Math.min(limit, 200)) as Row[];
  return rows.map(toJob);
}

export function findActiveJob(
  repositoryId: string,
  analysisType: AnalysisType,
  request: string | null,
): AnalysisJobRecord | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM analysis_jobs
       WHERE repository_id = ? AND analysis_type = ? AND COALESCE(request, '') = COALESCE(?, '')
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(repositoryId, analysisType, request) as Row | undefined;
  return row ? toJob(row) : null;
}

export function updateJob(
  id: string,
  patch: Partial<{
    status: AnalysisJobRecord["status"];
    stage: string | null;
    progress: number;
    summary: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
    modelProvider: string | null;
    modelName: string | null;
  }>,
): void {
  const columns: string[] = [];
  const values: (string | number | null)[] = [];
  const map: Record<string, string> = {
    status: "status",
    stage: "stage",
    progress: "progress",
    summary: "summary",
    errorCode: "error_code",
    errorMessage: "error_message",
    startedAt: "started_at",
    completedAt: "completed_at",
    modelProvider: "model_provider",
    modelName: "model_name",
  };
  for (const [key, column] of Object.entries(map)) {
    if (key in patch) {
      columns.push(`${column} = ?`);
      const value = (patch as Record<string, unknown>)[key];
      values.push(value === undefined ? null : (value as string | number | null));
    }
  }
  if (columns.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE analysis_jobs SET ${columns.join(", ")} WHERE id = ?`).run(...values);
}

/** Mark jobs that were interrupted by a crash/restart as failed. */
export function reapStaleJobs(): number {
  const result = getDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = 'failed', error_code = 'INTERNAL_ERROR',
           error_message = 'The analysis was interrupted by a server restart.',
           completed_at = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(nowIso());
  return Number(result.changes);
}

export function insertFindings(
  jobId: string,
  findings: Omit<FindingRecord, "id" | "analysisJobId">[],
): FindingRecord[] {
  const db = getDb();
  const now = nowIso();
  const inserted: FindingRecord[] = [];
  withTransaction(() => {
    for (const finding of findings) {
      const id = newId("find");
      db.prepare(
        `INSERT INTO findings
          (id, analysis_job_id, category, severity, title, description, file_path, start_line, end_line,
           confidence, evidence, verification_status, source, remediation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        jobId,
        finding.category,
        finding.severity,
        finding.title,
        finding.description,
        finding.filePath,
        finding.startLine,
        finding.endLine,
        finding.confidence,
        finding.evidence,
        finding.verificationStatus,
        finding.source,
        finding.remediation,
        now,
      );
      inserted.push({ ...finding, id, analysisJobId: jobId });
    }
  });
  return inserted;
}

export function getFindingById(id: string): FindingRecord | null {
  const row = getDb().prepare("SELECT * FROM findings WHERE id = ?").get(id) as Row | undefined;
  return row ? toFinding(row) : null;
}

export function listFindings(jobId: string): FindingRecord[] {  const rows = getDb()
    .prepare("SELECT * FROM findings WHERE analysis_job_id = ?")
    .all(jobId) as Row[];
  return rows
    .map(toFinding)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function listFindingsForRepository(repositoryId: string, limit = 200): FindingRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT f.* FROM findings f
       JOIN analysis_jobs j ON j.id = f.analysis_job_id
       WHERE j.repository_id = ?
       ORDER BY f.created_at DESC LIMIT ?`,
    )
    .all(repositoryId, limit) as Row[];
  return rows.map(toFinding);
}

export function countJobs(repositoryId?: string): number {
  const row = repositoryId
    ? (getDb().prepare("SELECT COUNT(*) AS count FROM analysis_jobs WHERE repository_id = ?").get(repositoryId) as Row | undefined)
    : (getDb().prepare("SELECT COUNT(*) AS count FROM analysis_jobs").get() as Row | undefined);
  return Number(row?.count ?? 0);
}

export function countReports(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM reports").get() as Row | undefined;
  return Number(row?.count ?? 0);
}

export function severityCounts(repositoryId?: string): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const rows = repositoryId
    ? (getDb()
        .prepare(
          `SELECT f.severity AS severity, COUNT(*) AS count FROM findings f
           JOIN analysis_jobs j ON j.id = f.analysis_job_id
           WHERE j.repository_id = ? GROUP BY f.severity`,
        )
        .all(repositoryId) as Row[])
    : (getDb()
        .prepare("SELECT severity, COUNT(*) AS count FROM findings GROUP BY severity")
        .all() as Row[]);
  for (const row of rows) {
    const severity = String(row.severity) as Severity;
    if (severity in counts) counts[severity] = Number(row.count);
  }
  return counts;
}

export function createReview(input: {
  repositoryId: string;
  jobId: string;
  mode: ReviewRecord["mode"];
  range: string | null;
  changedFiles: string[];
  summary: string | null;
}): ReviewRecord {
  const id = newId("review");
  const now = nowIso();
  getDb()
    .prepare(
      "INSERT INTO reviews (id, repository_id, job_id, mode, range, changed_files, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.repositoryId,
      input.jobId,
      input.mode,
      input.range,
      JSON.stringify(input.changedFiles),
      input.summary,
      now,
    );
  return {
    id,
    repositoryId: input.repositoryId,
    jobId: input.jobId,
    mode: input.mode,
    range: input.range,
    changedFiles: input.changedFiles,
    summary: input.summary,
    createdAt: now,
  };
}

function toReview(row: Row): ReviewRecord {
  let files: string[] = [];
  try {
    files = JSON.parse(String(row.changed_files)) as string[];
  } catch {
    files = [];
  }
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    jobId: String(row.job_id),
    mode: String(row.mode) as ReviewRecord["mode"],
    range: row.range ? String(row.range) : null,
    changedFiles: files,
    summary: row.summary ? String(row.summary) : null,
    createdAt: String(row.created_at),
  };
}

export function getReview(id: string): ReviewRecord | null {
  const row = getDb().prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Row | undefined;
  return row ? toReview(row) : null;
}

export function getReviewByJobId(jobId: string): ReviewRecord | null {
  const row = getDb().prepare("SELECT * FROM reviews WHERE job_id = ?").get(jobId) as Row | undefined;
  return row ? toReview(row) : null;
}

export function listReviews(limit = 50): ReviewRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM reviews ORDER BY created_at DESC LIMIT ?")
    .all(Math.min(limit, 200)) as Row[];
  return rows.map(toReview);
}

export function createPatch(input: {
  repositoryId: string;
  jobId: string | null;
  title: string;
  rationale: string;
  patchText: string;
  files: string[];
  status: PatchRecord["status"];
  validation: PatchValidation;
}): PatchRecord {
  const id = newId("patch");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO patches (id, repository_id, job_id, title, rationale, patch_text, files, status, validation, created_at, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.repositoryId,
      input.jobId,
      input.title,
      input.rationale,
      input.patchText,
      JSON.stringify(input.files),
      input.status,
      JSON.stringify(input.validation),
      now,
    );
  return { ...input, id, createdAt: now, appliedAt: null };
}

function toPatch(row: Row): PatchRecord {
  let files: string[] = [];
  let validation: PatchValidation = {
    ok: false,
    checkedAt: "",
    errors: ["Validation data unavailable."],
    filesTouched: [],
    appliesCleanly: false,
    diffStat: null,
  };
  try {
    files = JSON.parse(String(row.files)) as string[];
  } catch {
    files = [];
  }
  try {
    validation = JSON.parse(String(row.validation)) as PatchValidation;
  } catch {
    // keep the safe default above
  }
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    jobId: row.job_id ? String(row.job_id) : null,
    title: String(row.title),
    rationale: String(row.rationale),
    patchText: String(row.patch_text),
    files,
    status: String(row.status) as PatchRecord["status"],
    validation,
    createdAt: String(row.created_at),
    appliedAt: row.applied_at ? String(row.applied_at) : null,
  };
}

export function getPatch(id: string): PatchRecord | null {
  const row = getDb().prepare("SELECT * FROM patches WHERE id = ?").get(id) as Row | undefined;
  return row ? toPatch(row) : null;
}

export function listPatches(repositoryId?: string, limit = 50): PatchRecord[] {
  const rows = repositoryId
    ? (getDb()
        .prepare("SELECT * FROM patches WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(repositoryId, Math.min(limit, 200)) as Row[])
    : (getDb()
        .prepare("SELECT * FROM patches ORDER BY created_at DESC LIMIT ?")
        .all(Math.min(limit, 200)) as Row[]);
  return rows.map(toPatch);
}

export function updatePatchStatus(
  id: string,
  status: PatchRecord["status"],
  validation?: PatchValidation,
): void {
  if (validation) {
    getDb()
      .prepare(
        "UPDATE patches SET status = ?, validation = ?, applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END WHERE id = ?",
      )
      .run(status, JSON.stringify(validation), status, nowIso(), id);
  } else {
    getDb()
      .prepare(
        "UPDATE patches SET status = ?, applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END WHERE id = ?",
      )
      .run(status, status, nowIso(), id);
  }
}

export function createReport(input: {
  repositoryId: string;
  jobId: string | null;
  reportType: ReportRecord["reportType"];
  title: string;
  markdown: string;
  json: string;
}): ReportRecord {
  const id = newId("report");
  const now = nowIso();
  getDb()
    .prepare(
      "INSERT INTO reports (id, repository_id, job_id, report_type, title, markdown, json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.repositoryId,
      input.jobId,
      input.reportType,
      input.title,
      input.markdown,
      input.json,
      now,
    );
  return { ...input, id, createdAt: now };
}

function toReport(row: Row): ReportRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    jobId: row.job_id ? String(row.job_id) : null,
    reportType: String(row.report_type) as ReportRecord["reportType"],
    title: String(row.title),
    markdown: String(row.markdown),
    json: String(row.json),
    createdAt: String(row.created_at),
  };
}

export function getReport(id: string): ReportRecord | null {
  const row = getDb().prepare("SELECT * FROM reports WHERE id = ?").get(id) as Row | undefined;
  return row ? toReport(row) : null;
}

export function getReportByJobId(jobId: string): ReportRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM reports WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(jobId) as Row | undefined;
  return row ? toReport(row) : null;
}

export function listReportsForRepository(repositoryId: string, limit = 50): ReportRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM reports WHERE repository_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(repositoryId, Math.min(limit, 200)) as Row[];
  return rows.map(toReport);
}

export function listReports(limit = 50): ReportRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT ?")
    .all(Math.min(limit, 200)) as Row[];
  return rows.map(toReport);
}

export function deleteReport(id: string): boolean {
  return Number(getDb().prepare("DELETE FROM reports WHERE id = ?").run(id).changes) > 0;
}
