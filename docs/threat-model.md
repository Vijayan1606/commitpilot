# Threat model

Scope: the local-first deployment (web UI on loopback, MCP server on loopback, SQLite on disk). A public multi-tenant deployment requires additional controls and is **not** claimed here.

| # | Threat | Vector | Mitigation | Residual risk | Test |
| --- | --- | --- | --- | --- | --- |
| 1 | Path traversal | `../../etc/passwd`, absolute paths, encoded separators | Repository-relative resolution rejects `..`, absolute paths, drive letters, device names; `realpath` + `path.relative` containment | A bug in the guard | `pathGuard.test.ts` |
| 2 | Symlink escape | A link inside the repo pointing outside the root | `realpath` before containment, on every read | TOCTOU between check and read | `pathGuard.test.ts` symlink case |
| 3 | Unauthorized repository access | Registering or reading a repo outside the workspace | Workspace root config, containment, `.git` requirement, revalidation on every operation | Operator sets a root containing other data | `pathGuard.test.ts`, smoke |
| 4 | Arbitrary command execution | Model or user supplies a shell string | No shell; fixed argv allowlist; two server gates; per-run confirmation; filtered env | Allowlisted scripts can do anything the repo script does, as your user | `security.test.ts` |
| 5 | Prompt injection in repo files | "Ignore previous instructions" in README/comments | Content fenced as data, explicit system rule, no tool access for the model, deterministic dispatch | Model may still be misled into a wrong finding | `security.test.ts` prompt-injection case; demo repo |
| 6 | Malicious source comments | Instructions inside code | Same as #5; findings must cite evidence | Wrong hypothesis | demo fixture |
| 7 | Secret leakage to a hosted model | `.env`, keys, tokens in source | Mandatory path exclusions + pattern redaction + preview + remote opt-in | A novel secret pattern may not match | `security.test.ts` secret checks |
| 8 | Credential exposure | API key echoed in UI/errors/logs | Stored encrypted (AES-256-GCM), write-only UI, last-4 display, redacted logs, no keys in model config objects | Local attacker with file access can read the key file / DB | `security.test.ts` credential case |
| 9 | Insecure API endpoints | Cross-site requests, DNS rebinding | Loopback binding, `Origin`/`Sec-Fetch-Site` checks on JSON mutations, no cookie auth, strict content type | A malicious local process can call the API | `security.test.ts` (origin test) |
| 10 | XSS | Model or repository text rendered in the UI | React escaping; Markdown rendered without raw HTML; no `dangerouslySetInnerHTML` in app code | Dependency bug | `rg dangerouslySetInnerHTML` → only static rule |
| 11 | CSRF | Automated form posts | JSON-only bodies; origin check; no credentials | Same-origin attacker already has access | origin check |
| 12 | Dependency vulnerabilities | Supply chain | Lockfile, pinned major versions, `npm audit` in CI, minimal dependencies | Unpatched 0-day | CI |
| 13 | Denial of service via large repositories | Huge files, deep trees, many files | File count/size caps, line caps, context budget, timeouts | Large diff parsing can still be slow | `security.test.ts` file-limit case |
| 14 | Excessive model requests | Repeated submissions | Active-job dedupe, MCP rate limit, timeouts, retries capped at 3 | Manual repeated distinct requests | `orchestrator` dedupe |
| 15 | Model response injection | Model output contains paths, HTML, or instructions | Strict JSON schema, path/line verification, redaction, React escaping, no execution of model text | Misleading finding text | `modelValidation.test.ts` |
| 16 | Unsafe patch application | Absolute/traversal paths, new/deleted files, binary patches | Shape checks, `a/`/`b/` prefixes, tracked-only, `git apply --check`, backup, flag + confirmation | Approved patch can still be wrong semantically | `patch.test.ts` |
| 17 | Untrusted Git configuration | Repo config altering behaviour | Git invoked with fixed args, `GIT_CONFIG_NOSYSTEM=1`, `safe.directory` scoped to the validated path, no hooks run | Repo-local filters could affect diffs | review |
| 18 | Malicious repository scripts | `npm test` runs repo code | Command execution off by default, two gates, explicit confirmation, warning text | User-approved script is trusted | `security.test.ts` gates |
| 19 | Log leakage | Source or secrets in logs | Structured events only; no prompts/files; redaction on every field | Error strings from Git/model could include a path | `redact.test.ts` |
| 20 | Unauthorized report access | Guessing ids | No public sharing; local-only; report ids are UUID-based | Local process access | design |

## Out of scope

- Multi-tenant isolation on a public host.
- Full OS sandboxing of allowlisted commands (no container/namespace isolation).
- Network egress filtering for repository scripts.
- Supply-chain signing and reproducible builds.

## Hardening priorities for a hosted deployment

1. Add authentication and per-user repository isolation; never expose host paths.
2. Move repository storage to an isolated per-user workspace or a Git provider connection.
3. Run command execution in a disposable sandbox with no network and no host mounts.
4. Put MCP behind TLS and short-lived per-user tokens.
5. Add quotas per user and per job.