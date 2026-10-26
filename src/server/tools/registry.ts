import { z } from "zod";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import { increment, observeLatency } from "../observability/metrics";

export type ToolRisk = "read" | "write";
export type ToolSurface = "web" | "mcp" | "stdio";

export interface ToolContext {
  surface: ToolSurface;
  correlationId: string;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  outputSchema: z.ZodType<unknown>;
  risk: ToolRisk;
  sideEffects: boolean;
  requiresConfirmation: boolean;
  timeoutMs: number;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  handler: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(config: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  outputSchema: z.ZodType<unknown>;
  risk: ToolRisk;
  sideEffects?: boolean;
  requiresConfirmation?: boolean;
  timeoutMs?: number;
  annotations?: Partial<ToolDefinition["annotations"]>;
  handler: (input: z.infer<S>, context: ToolContext) => Promise<unknown>;
}): ToolDefinition {
  const sideEffects = config.sideEffects ?? false;
  return {
    name: config.name,
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    risk: config.risk,
    sideEffects,
    requiresConfirmation: config.requiresConfirmation ?? false,
    timeoutMs: config.timeoutMs ?? 60_000,
    annotations: {
      readOnlyHint: !sideEffects,
      destructiveHint: sideEffects,
      idempotentHint: !sideEffects,
      openWorldHint: false,
      ...config.annotations,
    },
    handler: async (input, context) => config.handler(input as z.infer<S>, context),
  };
}

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(definitions: ToolDefinition[]) {
    for (const definition of definitions) {
      if (this.tools.has(definition.name)) {
        throw new Error(`Duplicate tool registration: ${definition.name}`);
      }
      this.tools.set(definition.name, definition);
    }
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  async dispatch(name: string, args: unknown, context: ToolContext): Promise<unknown> {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      increment("tool.unknown");
      throw new AppError("TOOL_NOT_FOUND", `Unknown tool: ${name}`);
    }

    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      increment("tool.invalid_arguments");
      throw new AppError("INVALID_ARGUMENTS", "The tool arguments did not pass validation.", {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const input = parsed.data as Record<string, unknown>;
    if (tool.requiresConfirmation && input.confirm !== true) {
      increment("tool.confirmation_required");
      throw new AppError(
        "TOOL_FORBIDDEN",
        `${tool.title} requires explicit confirmation (pass confirm: true).`,
      );
    }

    increment(`tool.${tool.name}.calls`);
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        tool.handler(input, context),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new AppError("TOOL_TIMEOUT", `${tool.title} exceeded its time limit.`)),
            tool.timeoutMs,
          );
        }),
      ]);

      const serialized = JSON.stringify(result);
      if (serialized === undefined) {
        throw new AppError("INTERNAL_ERROR", "The tool produced no result.", { expose: false });
      }
      if (Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) {
        throw new AppError("TOOL_OUTPUT_TOO_LARGE", "The tool result exceeded the size limit.");
      }

      const outputCheck = tool.outputSchema.safeParse(result);
      if (!outputCheck.success) {
        logger.error("tool_output_invalid", {
          tool: tool.name,
          issues: outputCheck.error.issues.length,
        });
        throw new AppError("INTERNAL_ERROR", "The tool produced an unexpected result shape.", {
          expose: false,
        });
      }

      increment(`tool.${tool.name}.success`);
      observeLatency(`tool.${tool.name}`, Date.now() - started);
      logger.info("tool_invoked", {
        tool: tool.name,
        surface: context.surface,
        correlationId: context.correlationId,
        durationMs: Date.now() - started,
        outcome: "success",
      });
      return result;
    } catch (error) {
      increment(`tool.${tool.name}.failure`);
      observeLatency(`tool.${tool.name}`, Date.now() - started);
      const appError =
        error instanceof AppError
          ? error
          : new AppError("INTERNAL_ERROR", "The tool failed unexpectedly.", { expose: false });
      logger.warn("tool_invoked", {
        tool: tool.name,
        surface: context.surface,
        correlationId: context.correlationId,
        durationMs: Date.now() - started,
        outcome: "failure",
        code: appError.code,
      });
      throw appError;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
