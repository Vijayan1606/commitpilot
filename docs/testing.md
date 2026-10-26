# Testing

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run
npm run build       # next build
npm run smoke       # production runtime checks (20)
npm run test:e2e    # Playwright: prepare demo repo + browser workflow + screenshots
npm run audit       # dependency advisories with a documented exception list
```

`npm test` uses a temporary SQLite database and temporary Git repositories inside an isolated workspace root. It never touches your real repositories or `.data/`.

## Results in this environment

Windows, Node 24.21.0, npm 11.1.0, Git 2.45.2, 2026-10-26.

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | pass (0 errors) |
| `npx eslint .` | pass (0 errors, 0 warnings) |
| `npx vitest run` | **92 tests / 12 files passed** in ~35 s |
| `npm run build` | pass; 34 routes (33 dynamic, 1 static) |
| `node scripts/smoke.mjs` | **20/20 checks passed** |
| `npm run test:e2e` | **1 browser workflow passed** in 16 s; 6 screenshots written |
| `npm run audit` | 0 blocking; 1 accepted (documented), 3 moderate build-time |
| `tests/integration/mcp.test.ts` | 6/6 with a real spawned MCP process and the official SDK client |

## Test matrix

| File | Tests | What is actually exercised |
| --- | --- | --- |
| `unit/pathGuard.test.ts` | 12 | Inside/outside roots, non-Git dirs, traversal, absolute/drive paths, symlink escape (junction), device names, prefix-vs-containment |
| `unit/exclusions.test.ts` | 6 | Mandatory secret files, dependency/build dirs, user globs, inability to re-include secrets, binary detection |
| `unit/redact.test.ts` | 6 | AWS/GitHub/bearer/assigned secrets, private-key blocks, line scanning, object redaction, false-positive check |
| `unit/diff.test.ts` | 4 | Unified diff parsing (modified/added/deleted), commit-range injection rejection |
| `unit/modelValidation.test.ts` | 8 | Fence extraction, alias normalisation, malformed-finding drops, envelope rejection, path/line rejection |
| `unit/registry.test.ts` | 7 | Unknown tool, invalid args, timeout, output cap, output-shape validation, confirmation gate |
| `unit/patch.test.ts` | 10 | Shape rejection (new/delete/rename/binary/absolute/traversal), real `git apply --check`, flag gate, backup creation, no-write on rejection |
| `unit/findings.test.ts` | 5 | Path verification, path stripping, line clamping, static labelling, dedupe + redaction |
| `unit/report.test.ts` | 6 | Markdown sections, empty-findings honesty, JSON shape, severity counts, filename sanitisation, patch report warning |
| `integration/workflow.test.ts` | 11 | Register → inspect → search → validate → analyse → review → patch → apply/reject with a **real HTTP OpenAI-compatible model server** |
| `integration/mcp.test.ts` | 6 | Spawned MCP process, 401 without token, tool list, structured calls, unknown tool, confirmation gate |
| `security/security.test.ts` | 11 | Unknown/invalid tools, model cannot self-approve, prompt injection, cross-origin rejection, command allowlist, credential non-disclosure, secret-free reports, file caps, timeout |
| `e2e/flow.spec.ts` | 1 | Real Chromium: register via the form, run a security review, assert evidence and verification labels, open the report, export JSON, capture screenshots. This row is Playwright, not part of the 92 Vitest tests. |

## What the model tests prove — and do not

The integration suite runs a local HTTP server that implements `POST /v1/chat/completions`. This proves:

- the adapter builds a valid request, sends the bearer header, and parses OpenAI-shaped responses;
- timeouts, 500s, and malformed content fail the job with the correct error code;
- findings are persisted only after path/line verification;
- the request body does **not** contain excluded secrets;
- a review receives a real `diff --git` payload.

It does **not** prove that a specific open model produces good findings, because no live provider was reachable in this environment. Those results depend on the model you configure.

## What was not run

| Item | Why | Status |
| --- | --- | --- |
| Live open-model analysis | No provider credentials or local weights in the build environment | Not verified — configure a model and run it |
| Alan desktop connector click-through | Needs an interactive Alan account session | Documented, not executed |
| Cloud Alan → local tunnel | Needs a public authenticated tunnel | Not executed |
| Docker image build/compose | Docker daemon not available in this environment | Files provided, unverified |

## Reproducing

```bash
npm ci
npm test
npm run build
npm run smoke
```

The smoke script creates `.workspaces/commitpilot-sample`, uses `.data-smoke/` for its database, and exits non-zero on any failed check.

Expected final line:

```
20/20 checks passed
```