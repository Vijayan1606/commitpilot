export const APP_NAME = "CommitPilot AI";
export const APP_VERSION = "0.1.0";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const FINDING_CATEGORIES = [
  "correctness",
  "security",
  "performance",
  "maintainability",
  "testing",
  "architecture",
  "data",
  "other",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const VERIFICATION_STATUSES = [
  "static_rule_match",
  "path_verified_model_hypothesis",
  "unverified_model_hypothesis",
  "needs_manual_verification",
  "verified_by_test",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ANALYSIS_TYPES = [
  "repository_analysis",
  "code_review",
  "test_gaps",
  "security_review",
  "code_search",
] as const;
export type AnalysisType = (typeof ANALYSIS_TYPES)[number];

/** Directories never traversed, indexed, or sent to a model. */
export const DEFAULT_EXCLUDED_DIRS = [
  ".git",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".gradle",
  ".idea",
  ".vscode",
  "target",
  "bin",
  "obj",
  "Pods",
  "DerivedData",
  ".terraform",
  ".serverless",
  ".yarn",
  ".pnpm-store",
] as const;

/**
 * Files whose names or extensions imply secrets. Excluded by default from
 * model context and from the file viewer. Users can add exclusions, but cannot
 * remove these mandatory protections through the UI.
 */
export const MANDATORY_SECRET_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..+)?$/i,
  /(^|\/)\.envrc$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.pgpass$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|asc|ppk)$/i,
  /(^|\/)credentials?(\.|$)/i,
  /(^|\/)secrets?(\.|$)/i,
  /(^|\/)(credentials?|secrets?|private)(\/|$)/i,
  /(^|\/)service[-_]?account.*\.json$/i,
  /(^|\/)\.aws\/.*$/i,
  /(^|\/)\.ssh\/.*$/i,
  /(^|\/)\.kube\/config$/i,
  /(^|\/)terraform\.tfstate(\.backup)?$/i,
];

export const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff", ".avif",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".tar",
  ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".ogg", ".webm", ".flac",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dll", ".so", ".dylib", ".a", ".o", ".obj", ".class", ".jar", ".war",
  ".pyc", ".pyo", ".wasm", ".bin", ".dat", ".db", ".sqlite", ".sqlite3",
  ".psd", ".ai", ".sketch", ".fig", ".blend",
]);

/** Extensions treated as source for language estimates and analysis. */
export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust", ".java": "Java",
  ".kt": "Kotlin", ".swift": "Swift", ".php": "PHP", ".cs": "C#", ".c": "C",
  ".h": "C", ".cpp": "C++", ".cc": "C++", ".hpp": "C++", ".m": "Objective-C",
  ".scala": "Scala", ".sh": "Shell", ".bash": "Shell", ".ps1": "PowerShell",
  ".sql": "SQL", ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".vue": "Vue",
  ".svelte": "Svelte", ".md": "Markdown", ".mdx": "Markdown", ".yml": "YAML",
  ".yaml": "YAML", ".json": "JSON", ".toml": "TOML", ".graphql": "GraphQL",
};

export const MANIFEST_FILES = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "mix.exs",
  "pubspec.yaml",
  "Dockerfile",
  "docker-compose.yml",
  "compose.yaml",
] as const;

export const MAX_EXCERPT_LINES = 400;
export const MAX_FINDINGS = 40;
