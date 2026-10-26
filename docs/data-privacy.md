# Data privacy

## Summary

CommitPilot is local-first. Repositories stay on your machine. Only a bounded, redacted excerpt is ever sent to the model endpoint you configure, and nothing is sent at all until a model is configured and remote use is allowed.

## What is read

- Repository metadata: branch, commit hash, status, tracked file paths, manifests.
- Text excerpts from tracked files that pass the exclusion rules.
- Git diffs for the selected mode.
- No untracked files, no `.git` internals, no dependency directories, no excluded paths.

## What is persisted

| Data | Stored in | Contents |
| --- | --- | --- |
| Repository registration | SQLite | name, canonical path, timestamps |
| Analysis jobs | SQLite | type, status, question, summary, model name, correlation id, errors |
| Findings | SQLite | title, description, evidence snippet, path/line, confidence, remediation, verification |
| Reviews | SQLite | mode, range, changed-file list, summary |
| Patches | SQLite | diff text, file list, validation result, status |
| Reports | SQLite | Markdown and JSON snapshots of the above |
| Operations | SQLite | operation type, outcome, timestamps |
| Settings | SQLite | model endpoint/model, exclusions, limits, encrypted credential |
| Metrics | SQLite | model latency, outcome, error code (no prompts) |
| Backups | `.data/backups/` | copies of files touched by an applied patch |
| Logs | stdout | redacted application events |

No full repository snapshot is stored. Evidence excerpts exist in the report only for findings that cite them.

## What is transmitted

To the configured model endpoint (`POST /chat/completions`): model id, system prompt, repository metadata, fenced file excerpts with line numbers, the user's question, and (for reviews) the diff. No API key is sent anywhere except as the provider's `Authorization` header.

When the endpoint is loopback (Ollama, LM Studio, vLLM on localhost), no data leaves the machine. When it is hosted, the provider's terms and retention policy apply.

## Controls

- **Preview context** (repository page) shows the exact files, character counts, and redaction counts that would be sent, without calling the model.
- **Mandatory exclusions** cannot be disabled.
- **Remote consent:** a non-loopback endpoint is refused until *Allow sending repository excerpts to a remote endpoint* is enabled.
- **Secret redaction** runs before transmission and before findings are stored.
- **Output caps** limit how much text can leave in one request.
- **No telemetry.** The app makes no analytics or update-check requests.

## Retention

There is no automatic background deletion. Policies are explicit:

| Item | Default retention | How to remove |
| --- | --- | --- |
| Reports | operator-defined | `npm run cleanup` (default 90 days) or Delete in the UI |
| Patch backups | 30 days | `npm run cleanup` |
| Temporary patch files | 1 day | `npm run cleanup` |
| Jobs/findings | indefinite | Delete the repository registration (cascades) or the database |
| Logs | stdout, rotated by the host | host logging configuration |

Configure with `COMMITPILOT_REPORT_RETENTION_DAYS` and `COMMITPILOT_BACKUP_RETENTION_DAYS`.

To remove everything: stop both processes and delete `.data/`. Repositories are untouched.

## Multi-user and hosted use

The current deployment is single-user and has no tenant isolation. Do not host it as a public service with access to a shared filesystem. A hosted version would require per-user repository workspaces, authentication, per-user quotas, and a different model-credential strategy.

## User responsibilities

- Only register repositories you are authorized to inspect. The tool cannot verify ownership.
- Review the provider's data terms before enabling a hosted endpoint.
- Do not commit a real `.env` to a repository you later analyse; the tool excludes it, but Git history may already contain it.
- Treat AI findings as hypotheses, especially before acting on a security claim.