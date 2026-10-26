/**
 * Secret redaction. Applied to log fields, error messages, model input
 * previews and exported diagnostics. It is deliberately conservative: a false
 * positive costs a redacted string, a false negative leaks a credential.
 */

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "aws_access_key", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github_token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "stripe_key", pattern: /\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "openai_key", pattern: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: "assigned_secret",
    pattern:
      /\b(api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|auth[_-]?token|access[_-]?token|private[_-]?token)\b\s*[:=]\s*(["'`])([^"'`\s]{8,})\2/gi,
  },
  {
    name: "bearer",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  },
];

export const REDACTED = "[REDACTED]";

export function redactSecrets(input: string): string {
  let output = input;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, (match, ...groups: unknown[]) => {
      if (rule.name === "assigned_secret") {
        const key = String(groups[0] ?? "");
        const quote = String(groups[1] ?? '"');
        return `${key}=${quote}${REDACTED}${quote}`;
      }
      return REDACTED;
    });
  }
  return output;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (typeof value === "string") {
    return redactSecrets(value.length > 2000 ? value.slice(0, 2000) + "…" : value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization|cookie/i.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactValue(item, depth + 1);
      }
    }
    return out;
  }
  return "[unserializable]";
}

export interface SecretMatch {
  rule: string;
  line: number;
  preview: string;
}

/** Detect likely secrets in a text file without returning the raw secret. */
export function scanForSecrets(content: string, maxMatches = 20): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const rule of RULES) {
      const single = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", ""));
      if (single.test(line)) {
        matches.push({
          rule: rule.name,
          line: index + 1,
          preview: redactSecrets(line.trim()).slice(0, 120),
        });
        break;
      }
    }
    if (matches.length >= maxMatches) break;
  }
  return matches;
}
