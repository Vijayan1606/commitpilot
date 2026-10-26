import { listTrackedFiles } from "../git/git";
import { filterTrackedFiles, readRepositoryFile } from "../fs/readFile";
import type { ModelFinding } from "../models/types";
import type { Severity } from "@/shared/constants";
import { redactSecrets, scanForSecrets } from "../observability/redact";

interface Rule {
  id: string;
  pattern: RegExp;
  severity: Severity;
  category: "security";
  title: string;
  description: string;
  remediation: string;
  /** Optional filter to reduce false positives. */
  skip?: (line: string) => boolean;
}

/**
 * Small, transparent rule set. These are leads for a human reviewer, not a
 * vulnerability scanner and never a confirmation of exploitability.
 */
const RULES: Rule[] = [
  {
    id: "dynamic-code-execution",
    pattern: /\b(eval\s*\(|new\s+Function\s*\(|vm\.runIn(New)?Context\s*\()/,
    severity: "high",
    category: "security",
    title: "Dynamic code evaluation",
    description: "The code evaluates a string as code. If any part of that string is influenced by user input, this is a code-injection risk.",
    remediation: "Replace dynamic evaluation with an explicit dispatch table or a safe parser.",
    skip: (line) => /^\s*(\/\/|\*|#)/.test(line),
  },
  {
    id: "shell-injection",
    pattern: /\b(exec|execSync|spawnSync|spawn)\s*\(\s*[`"'][^`"']*\$\{/,
    severity: "high",
    category: "security",
    title: "Shell command built from interpolation",
    description: "A shell command is assembled with template interpolation. Untrusted values in that string can change the command.",
    remediation: "Pass arguments as an array to execFile/spawn without a shell, and validate each argument.",
  },
  {
    id: "python-shell-true",
    pattern: /\bsubprocess\.(run|call|Popen|check_output)\s*\([^)]*shell\s*=\s*True/,
    severity: "high",
    category: "security",
    title: "subprocess called with shell=True",
    description: "shell=True interprets shell metacharacters. If arguments are not fully controlled, this enables command injection.",
    remediation: "Use a list of arguments with shell=False and validate inputs.",
  },
  {
    id: "sql-concatenation",
    pattern: /(query|execute|exec|raw)\s*\(\s*[`"'][^`"']*(SELECT|INSERT|UPDATE|DELETE)[^`"']*[`"']\s*\+/i,
    severity: "high",
    category: "security",
    title: "SQL statement assembled by concatenation",
    description: "A SQL statement is built with string concatenation. If any segment comes from a request, this is a SQL-injection risk.",
    remediation: "Use parameterised queries or an ORM binding API.",
  },
  {
    id: "sql-string-concat",
    pattern: /(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)[^\n"'`]*["'`]\s*\+\s*[A-Za-z_$]/i,
    severity: "high",
    category: "security",
    title: "SQL string concatenation",
    description: "A SQL statement is assembled with string concatenation. If the appended value comes from a request, this is a SQL-injection risk.",
    remediation: "Use parameterised queries and pass values as bind parameters.",
  },
  {
    id: "unsafe-html",
    pattern: /(dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\s*\()/,
    severity: "medium",
    category: "security",
    title: "Unsanitised HTML sink",
    description: "HTML is written from a value that may contain markup. This is an XSS risk unless the value is sanitised first.",
    remediation: "Render text, or sanitise with a maintained library such as DOMPurify before insertion.",
  },
  {
    id: "tls-verification-disabled",
    pattern: /(rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|verify\s*=\s*False)/,
    severity: "high",
    category: "security",
    title: "TLS certificate verification disabled",
    description: "Certificate verification is turned off, which allows man-in-the-middle interception of this connection.",
    remediation: "Remove the override and trust the correct CA bundle instead.",
  },
  {
    id: "weak-hash",
    pattern: /createHash\s*\(\s*['"](md5|sha1)['"]\s*\)/i,
    severity: "low",
    category: "security",
    title: "Weak hash algorithm",
    description: "MD5/SHA-1 are not collision resistant. They are unsafe for signatures, integrity checks, or password storage.",
    remediation: "Use SHA-256 or stronger; for passwords use argon2, scrypt, or bcrypt.",
  },
  {
    id: "cors-wildcard",
    pattern: /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*/,
    severity: "medium",
    category: "security",
    title: "Permissive CORS wildcard",
    description: "Any origin may read responses from this endpoint. Combined with credentials or sensitive data this is a serious exposure.",
    remediation: "Allow only explicit trusted origins and avoid credentialed wildcard CORS.",
  },
  {
    id: "unsafe-deserialization",
    pattern: /\b(pickle\.loads|yaml\.load\s*\((?![^)]*Loader)|Marshal\.load|ObjectInputStream)\b/,
    severity: "high",
    category: "security",
    title: "Unsafe deserialisation",
    description: "Deserialising untrusted input with this API can execute arbitrary code or construct unexpected objects.",
    remediation: "Use a safe loader (yaml.safe_load) or a schema-validated format such as JSON.",
  },
  {
    id: "os-system",
    pattern: /\bos\.(system|popen)\s*\(/,
    severity: "medium",
    category: "security",
    title: "OS command execution",
    description: "This call executes a command through the operating system shell. Verify that every argument is trusted and validated.",
    remediation: "Use subprocess with an argument list and validate inputs.",
  },
];

const MAX_SCANNED_FILES = 400;
const MAX_FILE_BYTES = 200_000;
const MAX_FINDINGS = 30;

export interface StaticScanResult {
  findings: ModelFinding[];
  scannedFiles: number;
  skippedFiles: number;
  secretFileFindings: number;
}

export async function runStaticSecurityScan(
  repositoryRoot: string,
  options: { maxFiles: number; userExclusions: string[] },
): Promise<StaticScanResult> {
  const tracked = await listTrackedFiles(repositoryRoot, options.maxFiles);
  const filtered = filterTrackedFiles(tracked.files, {
    maxFiles: Math.min(options.maxFiles, MAX_SCANNED_FILES),
    userExclusions: options.userExclusions,
  });

  const findings: ModelFinding[] = [];
  let scanned = 0;
  let skipped = 0;
  let secretFileFindings = 0;

  for (const file of filtered.files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|php|go|java|kt|cs|vue|svelte|sh|ps1|yml|yaml|json|toml)$/i.test(file)) {
      continue;
    }
    let content: string;
    try {
      const read = await readRepositoryFile(repositoryRoot, file, {
        maxBytes: MAX_FILE_BYTES,
        userExclusions: options.userExclusions,
        redact: false,
        maxLines: 4000,
      });
      content = read.content;
    } catch {
      skipped += 1;
      continue;
    }
    scanned += 1;
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.length > 400) continue;
      for (const rule of RULES) {
        if (rule.skip?.(line)) continue;
        if (!rule.pattern.test(line)) continue;
        if (findings.length >= MAX_FINDINGS) break;
        findings.push({
          category: rule.category,
          severity: rule.severity,
          title: rule.title,
          description: rule.description,
          evidence: redactSecrets(`${file}:${index + 1}: ${line.trim().slice(0, 240)}`),
          filePath: file,
          startLine: index + 1,
          endLine: index + 1,
          confidence: "medium",
          remediation: rule.remediation,
        });
      }
      if (findings.length >= MAX_FINDINGS) break;
    }

    const secrets = scanForSecrets(content, 1);
    if (secrets.length > 0 && findings.length < MAX_FINDINGS) {
      secretFileFindings += 1;
      const match = secrets[0];
      findings.push({
        category: "security",
        severity: "high",
        title: "Possible hardcoded credential",
        description:
          "A string matching a credential pattern appears in tracked source. The value is not reproduced here. Confirm whether it is a real secret and rotate it if so.",
        evidence: `${file}:${match?.line ?? 1}: pattern "${match?.rule ?? "credential"}" matched (value redacted)`,
        filePath: file,
        startLine: match?.line ?? 1,
        endLine: match?.line ?? 1,
        confidence: "medium",
        remediation:
          "Remove the value from source, load it from the environment or a secret manager, and rotate it if it was ever committed.",
      });
    }

    if (findings.length >= MAX_FINDINGS) break;
  }

  return { findings, scannedFiles: scanned, skippedFiles: skipped, secretFileFindings };
}
