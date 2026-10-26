# Traceability matrix

Statuses:

- **Verified** — implemented and exercised by an executable check in this environment.
- **Implemented, not live-verified** — code and tests exist, but the external dependency (model provider, Alan UI, hosting) was unavailable.
- **Action required** — needs the participant's account or machine.
- **Out of scope** — deliberately not built.

## OpenFire submission requirements

Source: [luma.com/2k6cxr0n](https://luma.com/2k6cxr0n), read 2026-10-26.

| Requirement | Implementation | Verification | Status |
| --- | --- | --- | --- |
| Open-source tool for people using Alan AI | MIT repo, README, contributing guide, CI | `LICENSE`, docs, CI workflow | Action required: push to a public GitHub repo |
| Integrate Alan AI | MCP custom connector: Streamable HTTP server, 14 tools, bearer auth | `tests/integration/mcp.test.ts` (6/6) with the official SDK; `docs/alan-integration.md` | Implemented and protocol-verified; Alan UI click-through not verified |
| Use open models | `OpenModelProvider` for OpenAI-compatible endpoints; Qwen2.5-Coder documented | Adapter tested against a real local HTTP endpoint, including failure modes | Implemented; live provider call not verified |
| Solo participation | No collaboration features required | — | Participant confirms |
| Public GitHub repository | `.gitignore`, `.env.example`, licence, CI, no secrets in fixtures | `git status` review; demo fixtures are synthetic | Action required: create/push the remote |
| Working link | Production build + runtime smoke | `npm run build`, `npm run smoke` (20/20) | Local link verified; public hosting action required |
| X post with 1–3 min demo | Timed script in `docs/demo-script.md` | Script reviewed against the built UI | Action required: record and post |
| Submit before the deadline | Timeline documented in `docs/assumptions.md` (Tue 27 Oct, 8 PM build end, 10 PM form close IST) | — | Action required |

## Hackathon compliance criteria (brief §31)

| Criterion | Evidence | Status |
| --- | --- | --- |
| Alan AI is genuinely integrated | MCP server + SDK client test + docs | Protocol verified; vendor UI not |
| An open model is genuinely used for meaningful analysis | Adapter, prompts, schema validation, orchestration, failure tests | Code path verified; live call not |
| Project is open source | MIT licence | Verified in repo |
| Public repo contains working source and setup | README quickstart, `.env.example`, migrations automatic | Locally verified; remote action required |
| Reproducible setup | `npm ci`, `npm run dev`, `npm run mcp`, `npm run demo:setup` | Verified on Windows |
| Demo uses real functionality | Synthetic repo, real git, real tools | Verified |
| Submission materials satisfy the event | README + demo script + traceability | X post/link pending |

## Product functionality

| Criterion | Implementation | Test | Status |
| --- | --- | --- | --- |
| Repository registration | `POST /api/repositories`, `resolveRepositoryPath` | integration, smoke | Verified |
| Workspace restrictions | `pathGuard`, `isContained`, realpath | unit pathGuard, security | Verified |
| Git status inspection | `getGitStatus` | integration, smoke UI | Verified |
| Source search | `git grep` + exclusions + optional model summary | integration | Verified |
| Repository analysis | Orchestrator + model + verification + report | integration (fake HTTP model) | Adapter verified; live model pending |
| Code review | Diff retrieval + model + review record | integration | Adapter verified; live model pending |
| Findings contain actual evidence | Path/line verification + redaction | unit findings, integration | Verified |
| Reports persist | `reports` table + Markdown/JSON | integration, smoke export | Verified |
| Markdown and JSON export | `/api/reports/[id]/export` | smoke (both formats) | Verified |
| Patch proposals are reviewable | Shape validation, `git apply --check`, UI diff | unit patch, integration | Verified |
| Rejected patches leave files unchanged | `decidePatch(approve:false)` | unit + integration | Verified |
| Errors are handled honestly | Error codes, no fabricated report | integration (500, malformed, timeout) | Verified |

## Security criteria

| Criterion | Implementation | Test | Status |
| --- | --- | --- | --- |
| Path traversal prevented | Guard + traversal checks | unit pathGuard | Verified |
| Arbitrary command execution prevented | Allowlist + `execFile` + gates | unit security | Verified |
| Secrets excluded from model context | Mandatory exclusions + redaction + preview | integration/security request-body assertions | Verified |
| Tool arguments validated | Zod schemas + dispatcher | unit registry | Verified |
| Unknown tools rejected | Registry + MCP layer | unit + MCP test | Verified |
| Model output cannot bypass permissions | No tool access + dispatcher + confirm gate | security test | Verified |
| Prompt injection treated as untrusted | Fenced data + explicit system rule | security test, demo repo | Verified |
| Patch operations require approval | Two gates + confirmation + backup | unit/integration | Verified |
| Sensitive configuration not exposed | Encrypted key, last-4 only, redacted logs | security test | Verified |
| Public deployment does not expose host FS | Loopback binding, docs, no multi-tenant claim | runtime smoke + docs | Verified for local; hosting out of scope |

## Quality criteria

| Criterion | Result | Status |
| --- | --- | --- |
| Type checking passes | `tsc --noEmit` clean | Verified |
| Linting passes | `eslint .` clean | Verified |
| Tests pass | 92/92 across 12 files | Verified |
| Production build passes | `next build` succeeds, 34 routes | Verified |
| Database migrations work | Applied at startup; used by every test/smoke run | Verified |
| Documentation matches implementation | README + 10 docs written from the code and runs | Reviewed |
| No critical feature is a placeholder | Every button calls a real API; deterministic paths tested | Verified |
| Actual verification recorded | `docs/testing.md` | Verified |
| Browser workflow | Playwright: register ? security review ? report ? export | 1/1 passed |

## Feature map (brief sections → code)

| Brief | Code |
| --- | --- |
| §7 Repository registry | `server/db/repositories.ts`, `app/api/repositories`, `fs/pathGuard.ts` |
| §8 Explorer | `server/inspection/overview.ts`, `app/repositories/[id]`, `FileExplorer` |
| §9 AI analysis | `server/analysis/orchestrator.ts`, `models/*`, `analysis/findings.ts` |
| §10 Change review | `git/git.ts` (`getDiff`), orchestrator `runCodeReview`, `app/reviews` |
| §11 Security review | `analysis/securityRules.ts`, orchestrator `runSecurityWorkflow` |
| §12 Test gaps | `analysis/testGaps.ts`, orchestrator |
| §13 Code search | `analysis/search.ts`, `search_code` tool |
| §14 Patch proposals | `patches/patch.ts`, `patches/workflow.ts`, `PatchDecision` |
| §15 Safe commands | `commands/commands.ts`, `run_validation_command` |
| §16–17 Alan + tools | `mcp/*`, `tools/registry.ts`, `tools/definitions.ts` |
| §18 Frontend | `app/**`, `components/**` |
| §19 Persistence | `db/migrations.ts`, `db/*.ts` |
| §20 Jobs | `jobs/queue.ts`, orchestrator, `reapStaleJobs` |
| §21 Security/privacy | `fs/*`, `observability/redact.ts`, `config/secrets.ts`, docs |
| §22 Observability | `observability/logger.ts`, `metrics.ts`, `/api/health` |
| §23 Report export | `reports/report.ts`, `app/api/reports/[id]/export` |
| §24 Testing | `tests/**` |
| §25–27 Open source / Docker / CI | `LICENSE`, `.github/workflows/ci.yml`, Dockerfile, compose |
| §28 Docs | `README.md`, `docs/**` |
| §29 Demo | `demo/sample-repo`, `scripts/setup-demo.mjs`, `docs/demo-script.md` |

## Remaining gaps (explicit)

1. No live open-model run in this environment.
2. No Alan desktop connector click-through or cloud agent run.
3. No public GitHub repository, hosted link, X post, or submission form.
4. Docker build/compose unverified.
5. No dependency-vulnerability scanner results in a security review (deliberate scope).
6. No OS sandbox for allowlisted commands.
7. Multi-tenant hosting not implemented and not claimed.