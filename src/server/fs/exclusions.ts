import {
  BINARY_EXTENSIONS,
  DEFAULT_EXCLUDED_DIRS,
  MANDATORY_SECRET_FILE_PATTERNS,
} from "@/shared/constants";
import { AppError } from "../errors";

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export interface ExclusionDecision {
  excluded: boolean;
  reason?: "mandatory_secret" | "dependency_or_build_dir" | "user_exclusion" | "binary";
}

/** Additional user exclusions are additive: mandatory protections always apply. */
export function evaluatePath(
  relativePath: string,
  userExclusions: string[] = [],
): ExclusionDecision {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");

  if (segments.some((segment) => (DEFAULT_EXCLUDED_DIRS as readonly string[]).includes(segment))) {
    return { excluded: true, reason: "dependency_or_build_dir" };
  }
  if (MANDATORY_SECRET_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { excluded: true, reason: "mandatory_secret" };
  }
  for (const pattern of userExclusions) {
    const clean = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (!clean) continue;
    if (clean.includes("*") || clean.includes("?")) {
      if (globToRegExp(clean).test(normalized)) return { excluded: true, reason: "user_exclusion" };
      if (globToRegExp(`**/${clean}`).test(normalized)) {
        return { excluded: true, reason: "user_exclusion" };
      }
      continue;
    }
    if (
      normalized === clean ||
      normalized.startsWith(`${clean}/`) ||
      segments.includes(clean) ||
      normalized.endsWith(`/${clean}`)
    ) {
      return { excluded: true, reason: "user_exclusion" };
    }
  }
  return { excluded: false };
}

export function isBinaryExtension(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(lower.slice(dot));
}

export function looksBinaryContent(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

export function assertPathAllowed(relativePath: string, userExclusions: string[] = []): void {
  const decision = evaluatePath(relativePath, userExclusions);
  if (!decision.excluded) return;
  if (decision.reason === "mandatory_secret") {
    throw new AppError(
      "FILE_EXCLUDED",
      "This path is excluded because it can contain credentials or secrets.",
    );
  }
  if (decision.reason === "user_exclusion") {
    throw new AppError("FILE_EXCLUDED", "This path is excluded by the configured exclusions.");
  }
  throw new AppError("FILE_EXCLUDED", "This path is excluded because it contains generated or dependency files.");
}
