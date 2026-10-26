#!/usr/bin/env node
/**
 * Local retention policy.
 *
 *   npm run cleanup
 *
 * Deletes:
 *   - reports older than COMMITPILOT_REPORT_RETENTION_DAYS (default 90)
 *   - patch backups older than COMMITPILOT_BACKUP_RETENTION_DAYS (default 30)
 *   - temporary patch files older than one day
 *
 * It never touches repositories.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

try {
  if (fs.existsSync(path.resolve(process.cwd(), ".env"))) {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  }
} catch {
  // Explicit environment variables still work.
}

const dataDir = path.resolve(process.cwd(), process.env.COMMITPILOT_DATA_DIR ?? "./.data");
const dbPath = path.resolve(
  process.cwd(),
  process.env.COMMITPILOT_DB_PATH ?? path.join(dataDir, "commitpilot.db"),
);
const reportDays = Number(process.env.COMMITPILOT_REPORT_RETENTION_DAYS ?? 90);
const backupDays = Number(process.env.COMMITPILOT_BACKUP_RETENTION_DAYS ?? 30);

function olderThan(directory, days) {
  if (!fs.existsSync(directory)) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(directory)) {
    const target = path.join(directory, entry);
    const stat = fs.statSync(target);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(target, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

let reportsDeleted = 0;
if (fs.existsSync(dbPath) && reportDays > 0) {
  const db = new DatabaseSync(dbPath);
  const cutoff = new Date(Date.now() - reportDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare("DELETE FROM reports WHERE created_at < ?").run(cutoff);
  reportsDeleted = Number(result.changes);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.close();
}

const backups = olderThan(path.join(dataDir, "backups"), backupDays);
const temp = olderThan(path.join(dataDir, "tmp"), 1);

console.log(
  JSON.stringify(
    {
      reportsDeleted,
      backupDirectoriesDeleted: backups,
      tempFilesDeleted: temp,
      reportRetentionDays: reportDays,
      backupRetentionDays: backupDays,
    },
    null,
    2,
  ),
);