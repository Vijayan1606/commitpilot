import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { closeDb } from "@/server/db/client";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "commitpilot-test-"));

process.env.COMMITPILOT_WORKSPACE_ROOT = path.join(root, "workspaces");
process.env.COMMITPILOT_DATA_DIR = path.join(root, "data");
process.env.COMMITPILOT_DB_PATH = path.join(root, "data", "test.db");
process.env.COMMITPILOT_ALLOW_PATCH_APPLY = "false";
process.env.COMMITPILOT_ALLOW_COMMANDS = "false";
process.env.COMMITPILOT_LOG_LEVEL = "error";
process.env.OPENMODEL_BASE_URL = "";
process.env.OPENMODEL_MODEL = "";
process.env.OPENMODEL_API_KEY = "";
process.env.COMMITPILOT_MCP_TOKEN = "test-token-value-0123456789";

fs.mkdirSync(process.env.COMMITPILOT_WORKSPACE_ROOT, { recursive: true });
fs.mkdirSync(process.env.COMMITPILOT_DATA_DIR, { recursive: true });

afterAll(() => {
  closeDb();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows can hold SQLite WAL files briefly; the OS temp dir is disposable.
  }
});
