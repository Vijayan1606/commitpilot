export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "001_initial_schema",
    sql: `
      CREATE TABLE repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_checked_at TEXT
      );

      CREATE TABLE analysis_jobs (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        analysis_type TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        request TEXT,
        summary TEXT,
        error_code TEXT,
        error_message TEXT,
        model_provider TEXT,
        model_name TEXT,
        correlation_id TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_analysis_jobs_repo ON analysis_jobs(repository_id, created_at DESC);
      CREATE INDEX idx_analysis_jobs_status ON analysis_jobs(status);

      CREATE TABLE findings (
        id TEXT PRIMARY KEY,
        analysis_job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        file_path TEXT,
        start_line INTEGER,
        end_line INTEGER,
        confidence TEXT NOT NULL,
        evidence TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        source TEXT NOT NULL,
        remediation TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_findings_job ON findings(analysis_job_id);
      CREATE INDEX idx_findings_severity ON findings(severity);

      CREATE TABLE reviews (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        range TEXT,
        changed_files TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_reviews_repo ON reviews(repository_id, created_at DESC);

      CREATE TABLE patches (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES analysis_jobs(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        patch_text TEXT NOT NULL,
        files TEXT NOT NULL,
        status TEXT NOT NULL,
        validation TEXT NOT NULL,
        created_at TEXT NOT NULL,
        applied_at TEXT
      );
      CREATE INDEX idx_patches_repo ON patches(repository_id, created_at DESC);

      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES analysis_jobs(id) ON DELETE SET NULL,
        report_type TEXT NOT NULL,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_reports_repo ON reports(repository_id, created_at DESC);
      CREATE INDEX idx_reports_job ON reports(job_id);

      CREATE TABLE operations (
        id TEXT PRIMARY KEY,
        repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
        operation_type TEXT NOT NULL,
        outcome TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_operations_created ON operations(created_at DESC);
      CREATE INDEX idx_operations_repo ON operations(repository_id, created_at DESC);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE model_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        error_code TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_model_calls_created ON model_calls(created_at DESC);
    `,
  },
];
