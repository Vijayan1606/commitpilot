import { AppError } from "../errors";
import { resolveModelConfig } from "../config/settings";
import type { ModelConfig } from "../config/env";
import { recordModelCall } from "../db/repositories";
import { logger } from "../observability/logger";
import { redactSecrets } from "../observability/redact";
import {
  buildAnalysisMessages,
  buildDiffMessages,
  buildPatchMessages,
  buildSearchMessages,
  type ChatMessage,
} from "./prompts";
import { extractJsonObject, parseAnalysis } from "./validation";
import type {
  AnalysisInput,
  DiffInput,
  ModelAnalysis,
  ModelPatch,
  ModelSearchSummary,
  OpenModelProvider,
  PatchProposalInput,
  SearchSummaryInput,
} from "./types";

type ResolvedModelConfig = ModelConfig & {
  hosted: boolean;
  privacyBlocked: boolean;
  configured: boolean;
  providerLabel: string;
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export class OpenAiCompatibleProvider implements OpenModelProvider {
  private readonly config: ResolvedModelConfig;
  private readonly jobId: string | null;

  constructor(config: ResolvedModelConfig, jobId: string | null = null) {
    this.config = config;
    this.jobId = jobId;
  }

  private assertConfigured(): void {
    if (this.config.privacyBlocked) {
      throw new AppError(
        "MODEL_NOT_CONFIGURED",
        "The configured model endpoint is remote and remote model use is disabled in privacy settings.",
      );
    }
    if (!this.config.baseUrl || !this.config.model) {
      throw new AppError(
        "MODEL_NOT_CONFIGURED",
        "No open model is configured. Set OPENMODEL_BASE_URL and OPENMODEL_MODEL, or configure them in Settings.",
      );
    }
  }

  private async request(
    messages: ChatMessage[],
    maxTokens: number,
    useJsonMode: boolean,
  ): Promise<string> {
    this.assertConfigured();
    const baseUrl = stripTrailingSlash(this.config.baseUrl as string);
    const url = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false,
    };
    if (useJsonMode && this.config.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new AppError(
          "MODEL_TIMEOUT",
          `The model did not respond within ${Math.max(1, Math.round(this.config.timeoutMs / 1000))} seconds.`,
        );
      }
      throw new AppError(
        "MODEL_UNAVAILABLE",
        "The model endpoint could not be reached. Check the endpoint URL and that the provider is running.",
      );
    }

    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      const detail = redactSecrets(rawBody).slice(0, 300);
      if (response.status === 401 || response.status === 403) {
        throw new AppError("MODEL_UNAVAILABLE", "The model provider rejected the configured credentials.");
      }
      if (response.status === 404) {
        throw new AppError(
          "MODEL_UNAVAILABLE",
          "The model endpoint returned 404. Confirm the base URL ends with /v1 for an OpenAI-compatible server.",
        );
      }
      if (response.status === 429) {
        throw new AppError("MODEL_RATE_LIMITED", "The model provider rate-limited this request.");
      }
      if (response.status === 400 && useJsonMode) {
        // Some OpenAI-compatible servers do not implement response_format.
        throw new AppError("MODEL_UNAVAILABLE", `JSON_MODE_REJECTED:${detail}`);
      }
      if (response.status >= 500) {
        throw new AppError("MODEL_UNAVAILABLE", `The model provider failed with status ${response.status}.`);
      }
      throw new AppError(
        "MODEL_UNAVAILABLE",
        `The model provider rejected the request (status ${response.status}).`,
      );
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new AppError("MODEL_INVALID_RESPONSE", "The model response exceeded the size limit.");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AppError("MODEL_INVALID_RESPONSE", "The model provider returned malformed JSON.");
    }

    const content = extractMessageContent(payload);
    if (!content) {
      throw new AppError("MODEL_INVALID_RESPONSE", "The model response did not contain message content.");
    }
    return content;
  }

  private async chat(messages: ChatMessage[], maxTokens: number): Promise<string> {
    this.assertConfigured();
    const started = Date.now();
    let lastError: unknown;
    const attempts = Math.max(0, Math.min(this.config.maxRetries, 3)) + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
      try {
        let content: string;
        try {
          content = await this.request(messages, maxTokens, true);
        } catch (error) {
          if (
            error instanceof AppError &&
            error.code === "MODEL_UNAVAILABLE" &&
            error.message.startsWith("JSON_MODE_REJECTED:")
          ) {
            content = await this.request(messages, maxTokens, false);
          } else {
            throw error;
          }
        }
        recordModelCall({
          jobId: this.jobId,
          provider: this.config.providerLabel,
          model: this.config.model ?? "unknown",
          latencyMs: Date.now() - started,
          outcome: "success",
        });
        return content;
      } catch (error) {
        lastError = error;
        const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
        const retryable = code === "MODEL_RATE_LIMITED" || code === "MODEL_UNAVAILABLE";
        recordModelCall({
          jobId: this.jobId,
          provider: this.config.providerLabel,
          model: this.config.model ?? "unknown",
          latencyMs: Date.now() - started,
          outcome: code === "MODEL_TIMEOUT" ? "timeout" : "failure",
          errorCode: code,
        });
        logger.warn("model_call_failed", {
          code,
          attempt,
          latencyMs: Date.now() - started,
        });
        if (!retryable || attempt === attempts - 1) throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new AppError("MODEL_UNAVAILABLE", "The model call failed.");
  }

  async analyzeRepository(input: AnalysisInput): Promise<ModelAnalysis> {
    return this.runAnalysis("repository", input);
  }

  async generateImprovementPlan(input: AnalysisInput): Promise<ModelAnalysis> {
    return this.runAnalysis("plan", input);
  }

  async analyzeTestGaps(input: AnalysisInput): Promise<ModelAnalysis> {
    return this.runAnalysis("test_gaps", input);
  }

  async analyzeSecurity(input: AnalysisInput): Promise<ModelAnalysis> {
    return this.runAnalysis("security", input);
  }

  async runAnalysis(
    mode: "repository" | "plan" | "test_gaps" | "security",
    input: AnalysisInput,
  ): Promise<ModelAnalysis> {
    const messages = buildAnalysisMessages(mode, input, this.config.maxContextChars);
    const content = await this.chat(messages, 4000);
    try {
      return parseAnalysis(extractJsonObject(content));
    } catch (error) {
      throw new AppError(
        "MODEL_INVALID_RESPONSE",
        `The model returned an unusable analysis: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async reviewChanges(input: DiffInput): Promise<ModelAnalysis> {
    const messages = buildDiffMessages(input, this.config.maxContextChars);
    const content = await this.chat(messages, 4000);
    try {
      return parseAnalysis(extractJsonObject(content));
    } catch (error) {
      throw new AppError(
        "MODEL_INVALID_RESPONSE",
        `The model returned an unusable review: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async proposePatch(input: PatchProposalInput): Promise<ModelPatch> {
    const messages = buildPatchMessages(input, this.config.maxContextChars);
    const content = await this.chat(messages, 4000);
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject(content) as Record<string, unknown>;
    } catch {
      throw new AppError("MODEL_INVALID_RESPONSE", "The model did not return a valid patch proposal.");
    }

    const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : "";
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 4000) : "";
    const notes = typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 2000) : null;
    const diffRaw =
      typeof parsed.unifiedDiff === "string"
        ? parsed.unifiedDiff
        : typeof parsed.patch === "string"
          ? parsed.patch
          : typeof parsed.diff === "string"
            ? parsed.diff
            : "";
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
      : [];

    const unifiedDiff = diffRaw.replace(/\r\n/g, "\n").trimEnd() + "\n";
    if (!unifiedDiff) {
      throw new AppError(
        "PATCH_INVALID",
        notes || "The model could not produce a safe patch from the available evidence.",
      );
    }
    if (unifiedDiff.length > 200_000) {
      throw new AppError("PATCH_INVALID", "The proposed patch is too large to review safely.");
    }
    if (!title || !rationale) {
      throw new AppError("PATCH_INVALID", "The model's patch proposal was missing a title or rationale.");
    }

    return { title, rationale, files, unifiedDiff, notes };
  }

  async summarizeSearch(input: SearchSummaryInput): Promise<ModelSearchSummary> {
    const messages = buildSearchMessages(input, this.config.maxContextChars);
    const content = await this.chat(messages, 1500);
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject(content) as Record<string, unknown>;
    } catch {
      throw new AppError("MODEL_INVALID_RESPONSE", "The model did not return a usable search summary.");
    }
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim().slice(0, 4000) : "";
    if (!answer) {
      throw new AppError("MODEL_INVALID_RESPONSE", "The model returned an empty search summary.");
    }
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
      : [];
    return { answer, files };
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    if (this.config.privacyBlocked) {
      return { ok: false, detail: "Remote model use is disabled by privacy settings." };
    }
    if (!this.config.baseUrl) {
      return { ok: false, detail: "No model endpoint configured." };
    }
    try {
      const response = await fetch(`${stripTrailingSlash(this.config.baseUrl)}/models`, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      return {
        ok: response.ok,
        detail: response.ok ? "Model endpoint reachable." : `Model endpoint returned ${response.status}.`,
      };
    } catch {
      return { ok: false, detail: "Model endpoint unreachable." };
    }
  }
}

function extractMessageContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
    return parts || null;
  }
  return null;
}

export function createModelProvider(jobId: string | null = null): OpenModelProvider {
  return new OpenAiCompatibleProvider(resolveModelConfig(), jobId);
}

export function describeModelConfiguration(): {
  provider: string;
  model: string | null;
  baseUrlHost: string | null;
  configured: boolean;
  hosted: boolean;
  privacyBlocked: boolean;
} {
  const config = resolveModelConfig();
  let host: string | null = null;
  try {
    host = config.baseUrl ? new URL(config.baseUrl).host : null;
  } catch {
    host = null;
  }
  return {
    provider: config.providerLabel,
    model: config.model,
    baseUrlHost: host,
    configured: config.configured,
    hosted: config.hosted,
    privacyBlocked: config.privacyBlocked,
  };
}
