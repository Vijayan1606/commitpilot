import path from "node:path";

export interface ModelConfig {
  baseUrl: string | null;
  model: string | null;
  /** Never exposed to the browser. */
  apiKey: string | null;
  timeoutMs: number;
  maxRetries: number;
  maxContextChars: number;
  jsonMode: boolean;
}

export interface Limits {
  maxFiles: number;
  maxFileBytes: number;
  maxDiffBytes: number;
  maxContextChars: number;
  maxFindings: number;
  commandTimeoutMs: number;
  maxCommandOutputBytes: number;
}

export interface AppConfig {
  nodeEnv: string;
  workspaceRoot: string;
  dataDir: string;
  dbPath: string;
  model: ModelConfig;
  limits: Limits;
  allowPatchApply: boolean;
  allowCommands: boolean;
  mcp: { host: string; port: number; token: string | null; publicUrl: string | null };
  appSecret: string | null;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function trimmed(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

export function getConfig(): AppConfig {
  const cwd = process.cwd();
  const dataDir = path.resolve(cwd, trimmed(process.env.COMMITPILOT_DATA_DIR) ?? "./.data");
  const baseUrl = trimmed(process.env.OPENMODEL_BASE_URL);
  const model = trimmed(process.env.OPENMODEL_MODEL);

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    workspaceRoot: path.resolve(
      cwd,
      trimmed(process.env.COMMITPILOT_WORKSPACE_ROOT) ?? "./.workspaces",
    ),
    dataDir,
    dbPath: path.resolve(
      cwd,
      trimmed(process.env.COMMITPILOT_DB_PATH) ?? path.join(dataDir, "commitpilot.db"),
    ),
    model: {
      baseUrl,
      model,
      apiKey: trimmed(process.env.OPENMODEL_API_KEY),
      timeoutMs: intEnv("OPENMODEL_TIMEOUT_MS", 120_000),
      maxRetries: intEnv("OPENMODEL_MAX_RETRIES", 1),
      maxContextChars: intEnv("OPENMODEL_MAX_CONTEXT_CHARS", 120_000),
      jsonMode: boolEnv("OPENMODEL_JSON_MODE", true),
    },
    limits: {
      maxFiles: intEnv("COMMITPILOT_MAX_FILES", 2000),
      maxFileBytes: intEnv("COMMITPILOT_MAX_FILE_BYTES", 262_144),
      maxDiffBytes: intEnv("COMMITPILOT_MAX_DIFF_BYTES", 200_000),
      maxContextChars: intEnv("OPENMODEL_MAX_CONTEXT_CHARS", 120_000),
      maxFindings: 40,
      commandTimeoutMs: intEnv("COMMITPILOT_COMMAND_TIMEOUT_MS", 180_000),
      maxCommandOutputBytes: intEnv("COMMITPILOT_MAX_COMMAND_OUTPUT", 20_000),
    },
    allowPatchApply: boolEnv("COMMITPILOT_ALLOW_PATCH_APPLY", false),
    allowCommands: boolEnv("COMMITPILOT_ALLOW_COMMANDS", false),
    mcp: {
      host: trimmed(process.env.COMMITPILOT_MCP_HOST) ?? "127.0.0.1",
      port: intEnv("COMMITPILOT_MCP_PORT", 4319),
      token: trimmed(process.env.COMMITPILOT_MCP_TOKEN),
      publicUrl: trimmed(process.env.COMMITPILOT_PUBLIC_URL),
    },
    appSecret: trimmed(process.env.COMMITPILOT_APP_SECRET),
  };
}

/** Test helper: drop memoized values (config is read fresh, so this is a no-op hook). */
export function resetConfigCache(): void {
  // Intentionally empty: config is derived from process.env on each call.
}
