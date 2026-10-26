import { z } from "zod";
import { getConfig } from "./env";
import { decryptString, encryptString } from "./secrets";
import { deleteSetting, getSetting, listRepositories, setSetting } from "../db/repositories";
import { AppError } from "../errors";
import { resolveWorkspaceRoot, isContained } from "../fs/pathGuard";
import type { ModelConfig } from "./env";

const SETTINGS_KEY = "app_settings";
const MODEL_KEY = "model_api_key";

const SettingsSchema = z.object({
  workspaceRoot: z.string().min(1).max(500).nullable(),
  model: z.object({
    baseUrl: z.string().url().max(500).nullable(),
    model: z.string().min(1).max(200).nullable(),
  }),
  exclusions: z.array(z.string().min(1).max(300)).max(100),
  privacy: z.object({
    allowHostedModel: z.boolean(),
  }),
  limits: z.object({
    maxFiles: z.number().int().min(10).max(20_000),
    maxContextChars: z.number().int().min(4_000).max(1_000_000),
  }),
  commandExecution: z.object({
    enabled: z.boolean(),
  }),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): AppSettings {
  const config = getConfig();
  return {
    workspaceRoot: null,
    model: { baseUrl: null, model: null },
    exclusions: [],
    privacy: { allowHostedModel: true },
    limits: {
      maxFiles: config.limits.maxFiles,
      maxContextChars: config.limits.maxContextChars,
    },
    commandExecution: { enabled: config.allowCommands },
  };
}

export function getSettings(): AppSettings {
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(patch: unknown): Promise<AppSettings> {
  const current = getSettings();
  let merged: AppSettings;
  try {
    merged = SettingsSchema.parse({
      ...current,
      ...(typeof patch === "object" && patch !== null ? patch : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AppError("INVALID_ARGUMENTS", "The settings payload is invalid.", {
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    throw error;
  }

  if (merged.workspaceRoot) {
    if (!merged.workspaceRoot.trim()) {
      merged.workspaceRoot = null;
    } else {
      const realRoot = await resolveWorkspaceRoot(merged.workspaceRoot);
      const outside = listRepositories().filter((repo) => !isContained(realRoot, repo.path));
      if (outside.length > 0) {
        throw new AppError(
          "CONFIG_INVALID",
          `${outside.length} registered repositories would fall outside the new workspace root. Remove them first.`,
        );
      }
      merged.workspaceRoot = realRoot;
    }
  }

  setSetting(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export async function getWorkspaceRoot(): Promise<string> {
  const settings = getSettings();
  return resolveWorkspaceRoot(settings.workspaceRoot ?? getConfig().workspaceRoot);
}

export function getModelApiKey(): string | null {
  const stored = getSetting(MODEL_KEY);
  if (stored) {
    try {
      return decryptString(stored);
    } catch {
      return null;
    }
  }
  return getConfig().model.apiKey;
}

export function setModelApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (trimmed.length < 8 || trimmed.length > 500) {
    throw new AppError("INVALID_ARGUMENTS", "The API key looks invalid.");
  }
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    throw new AppError("INVALID_ARGUMENTS", "The API key contains unsupported characters.");
  }
  setSetting(MODEL_KEY, encryptString(trimmed));
}

export function clearModelApiKey(): void {
  deleteSetting(MODEL_KEY);
}

export function getModelKeyStatus(): {
  configured: boolean;
  source: "settings" | "environment" | "none";
  last4: string | null;
} {
  if (getSetting(MODEL_KEY)) {
    const key = getModelApiKey();
    return { configured: Boolean(key), source: "settings", last4: key ? key.slice(-4) : null };
  }
  const envKey = getConfig().model.apiKey;
  return {
    configured: Boolean(envKey),
    source: envKey ? "environment" : "none",
    last4: envKey ? envKey.slice(-4) : null,
  };
}

export function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function resolveModelConfig(): ModelConfig & {
  hosted: boolean;
  privacyBlocked: boolean;
  configured: boolean;
  providerLabel: string;
} {
  const config = getConfig();
  const settings = getSettings();
  const baseUrl = settings.model.baseUrl ?? config.model.baseUrl;
  const model = settings.model.model ?? config.model.model;
  const apiKey = getModelApiKey();
  const hosted = baseUrl ? !isLoopbackUrl(baseUrl) : false;
  const privacyBlocked = hosted && !settings.privacy.allowHostedModel;
  let host = "";
  try {
    host = baseUrl ? new URL(baseUrl).host : "";
  } catch {
    host = "";
  }
  return {
    baseUrl,
    model,
    apiKey,
    timeoutMs: config.model.timeoutMs,
    maxRetries: config.model.maxRetries,
    maxContextChars: settings.limits.maxContextChars,
    jsonMode: config.model.jsonMode,
    hosted,
    privacyBlocked,
    configured: Boolean(baseUrl && model) && !privacyBlocked,
    providerLabel: host ? `openai-compatible:${host}` : "unconfigured",
  };
}
