import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config/env";
import { MIGRATIONS } from "./migrations";

const connections = new Map<string, DatabaseSync>();

function openDatabase(dbPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
  applyMigrations(db);
  return db;
}

function applyMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => String(row.id)),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString(),
      );
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}

export function getDb(): DatabaseSync {
  const { dbPath } = getConfig();
  const existing = connections.get(dbPath);
  if (existing) return existing;
  const db = openDatabase(dbPath);
  connections.set(dbPath, db);
  return db;
}

/** Used by tests and graceful shutdown. */
export function closeDb(dbPath?: string): void {
  if (dbPath) {
    const db = connections.get(dbPath);
    if (db) {
      db.close();
      connections.delete(dbPath);
    }
    return;
  }
  for (const [key, db] of connections) {
    db.close();
    connections.delete(key);
  }
}

export function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
