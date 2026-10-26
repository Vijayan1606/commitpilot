import { getDb } from "./client";
import { newId, nowIso } from "../observability/ids";
import type { OperationRecord, RepositoryRecord } from "@/shared/types";

type Row = Record<string, unknown>;

function toRepository(row: Row): RepositoryRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
  };
}

export function createRepository(name: string, repositoryPath: string): RepositoryRecord {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM repositories WHERE path = ?").get(repositoryPath) as Row | undefined;
  if (existing) return toRepository(existing);
  const id = newId("repo");
  const now = nowIso();
  db.prepare(
    "INSERT INTO repositories (id, name, path, created_at, updated_at, last_checked_at) VALUES (?, ?, ?, ?, ?, NULL)",
  ).run(id, name, repositoryPath, now, now);
  const created = db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as Row;
  return toRepository(created);
}

export function listRepositories(): RepositoryRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM repositories ORDER BY created_at DESC")
    .all() as Row[];
  return rows.map(toRepository);
}

export function getRepository(id: string): RepositoryRecord | null {
  const row = getDb().prepare("SELECT * FROM repositories WHERE id = ?").get(id) as Row | undefined;
  return row ? toRepository(row) : null;
}

export function getRepositoryByPath(repositoryPath: string): RepositoryRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM repositories WHERE path = ?")
    .get(repositoryPath) as Row | undefined;
  return row ? toRepository(row) : null;
}

export function touchRepository(id: string, when = nowIso()): void {
  getDb()
    .prepare("UPDATE repositories SET last_checked_at = ?, updated_at = ? WHERE id = ?")
    .run(when, when, id);
}

export function deleteRepository(id: string): boolean {
  const result = getDb().prepare("DELETE FROM repositories WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

export function recordOperation(input: {
  repositoryId: string | null;
  operationType: string;
  outcome: OperationRecord["outcome"];
  correlationId: string;
  detail?: string | null;
}): void {
  getDb()
    .prepare(
      "INSERT INTO operations (id, repository_id, operation_type, outcome, correlation_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      newId("op"),
      input.repositoryId,
      input.operationType,
      input.outcome,
      input.correlationId,
      input.detail ?? null,
      nowIso(),
    );
}

export function listOperations(limit = 20): OperationRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM operations ORDER BY created_at DESC LIMIT ?")
    .all(Math.min(limit, 200)) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    repositoryId: row.repository_id ? String(row.repository_id) : null,
    operationType: String(row.operation_type),
    outcome: String(row.outcome) as OperationRecord["outcome"],
    correlationId: String(row.correlation_id),
    detail: row.detail ? String(row.detail) : null,
    createdAt: String(row.created_at),
  }));
}

export function recordModelCall(input: {
  jobId: string | null;
  provider: string;
  model: string;
  latencyMs: number;
  outcome: "success" | "failure" | "timeout" | "invalid";
  errorCode?: string | null;
}): void {
  getDb()
    .prepare(
      "INSERT INTO model_calls (job_id, provider, model, latency_ms, outcome, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.jobId,
      input.provider,
      input.model,
      Math.round(input.latencyMs),
      input.outcome,
      input.errorCode ?? null,
      nowIso(),
    );
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
  return row ? String(row.value) : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(key, value, nowIso());
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

export function getModelCallStats(sinceIso: string): {
  calls: number;
  failures: number;
  averageLatencyMs: number;
} {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS calls, SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END) AS failures, AVG(latency_ms) AS avg FROM model_calls WHERE created_at >= ?",
    )
    .get(sinceIso) as Row | undefined;
  return {
    calls: Number(row?.calls ?? 0),
    failures: Number(row?.failures ?? 0),
    averageLatencyMs: Math.round(Number(row?.avg ?? 0)),
  };
}
