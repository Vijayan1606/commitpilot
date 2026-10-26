import { z } from "zod";
import { jsonError, jsonOk, parseJsonBody } from "@/server/http/handler";
import { getConfig } from "@/server/config/env";
import {
  clearModelApiKey,
  getModelKeyStatus,
  getSettings,
  getWorkspaceRoot,
  saveSettings,
  setModelApiKey,
} from "@/server/config/settings";
import { describeModelConfiguration } from "@/server/models/provider";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const config = getConfig();
    const settings = getSettings();
    let workspaceRoot: string | null = null;
    let workspaceError: string | null = null;
    try {
      workspaceRoot = await getWorkspaceRoot();
    } catch (error) {
      workspaceError = error instanceof AppError ? error.message : "The workspace root is invalid.";
    }
    return jsonOk({
      settings,
      workspaceRoot,
      workspaceError,
      envWorkspaceRoot: config.workspaceRoot,
      model: describeModelConfiguration(),
      credential: getModelKeyStatus(),
      flags: {
        allowPatchApply: config.allowPatchApply,
        allowCommands: config.allowCommands,
        nodeEnv: config.nodeEnv,
      },
      limits: config.limits,
      mcp: {
        url: `${config.mcp.publicUrl ?? `http://${config.mcp.host}:${config.mcp.port}`}/mcp`,
        host: config.mcp.host,
        port: config.mcp.port,
        tokenConfigured: Boolean(config.mcp.token),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

const PatchSchema = z.object({
  workspaceRoot: z.string().max(500).nullable().optional(),
  model: z
    .object({
      baseUrl: z.string().url().max(500).nullable(),
      model: z.string().max(200).nullable(),
    })
    .optional(),
  exclusions: z.array(z.string().min(1).max(300)).max(100).optional(),
  privacy: z.object({ allowHostedModel: z.boolean() }).optional(),
  limits: z
    .object({
      maxFiles: z.number().int().min(10).max(20_000),
      maxContextChars: z.number().int().min(4_000).max(1_000_000),
    })
    .optional(),
  commandExecution: z.object({ enabled: z.boolean() }).optional(),
});

export async function PUT(request: Request): Promise<Response> {
  try {
    const parsed = PatchSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "The settings payload is invalid.", {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const settings = await saveSettings(parsed.data);
    return jsonOk({ settings });
  } catch (error) {
    return jsonError(error);
  }
}

const KeySchema = z.object({ apiKey: z.string().min(8).max(500) });

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = KeySchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      throw new AppError("INVALID_ARGUMENTS", "Provide a model API key.");
    }
    setModelApiKey(parsed.data.apiKey);
    return jsonOk({ credential: getModelKeyStatus() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(): Promise<Response> {
  try {
    clearModelApiKey();
    return jsonOk({ credential: getModelKeyStatus() });
  } catch (error) {
    return jsonError(error);
  }
}
