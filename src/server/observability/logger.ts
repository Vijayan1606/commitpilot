import { redactValue } from "./redact";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.COMMITPILOT_LOG_LEVEL ?? "info").toLowerCase();
  return LEVEL_ORDER[(raw as Level) in LEVEL_ORDER ? (raw as Level) : "info"];
}

/**
 * Structured JSON logging. Never log source content, prompts, model output or
 * credentials; fields pass through redaction as a second line of defence.
 */
export function log(
  level: Level,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(redactValue(fields) as Record<string, unknown>),
  });
  if (level === "error") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
};
