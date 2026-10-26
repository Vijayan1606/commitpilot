# Assumptions and unverified details

This file exists so nobody has to guess what was checked and what was not.

## Event facts (verified 2026-10-26)

Source: [OpenFire Hackathon on Luma](https://luma.com/2k6cxr0n)

- Online hackathon: build an open-source tool for people using Alan AI, with open models.
- Solo participation.
- Timeline (IST): Mon 26 Oct 12 PM early access + credits, 1 PM hackathon begins; **Tue 27 Oct 8 PM building ends**; **Tue 27 Oct 10 PM submission form closes**.
- Submission: an X post with a 1–3 minute demo, a working link, and a public GitHub open-source repo.
- Prizes: top 5 get fast-tracked interviews with Alan AI.
- The event page does not state a required licence, a required framework, or a mandatory SDK. MIT was chosen deliberately.

## Alan integration

- Alan's own docs describe MCP connectors: [Plugins and MCP](https://docs.tryalan.ai/docs/skills/plugins-and-mcp), read 2026-10-26. The page says custom connectors are added under **Settings → Plugins → MCP → Add custom connector** and that credentials are stored encrypted.
- **Assumption:** the connector accepts a standard MCP Streamable HTTP endpoint with an `Authorization` header. The exact form fields in the current desktop build were not observed.
- **Verified:** the server implements MCP with the official `@modelcontextprotocol/sdk`, and the official client completes the handshake, `tools/list`, and `tools/call` over real HTTP with bearer auth.
- **Not verified:** adding the connector inside the Alan desktop app, and a cloud Alan agent invoking it. No interactive Alan account was used in this environment.
- The tool names (`inspect_repository`, `analyze_repository`, `review_git_changes`, `search_code`, `analyze_test_gaps`, `propose_patch`, `get_analysis_report`) are CommitPilot's own logical capabilities, exposed as MCP tools. They are not claims about Alan-specific API method names.

## Open model

- **Assumption:** the participant can run a local open-weights model or reach an OpenAI-compatible hosted endpoint. The event page advertises "$20 of open source model credits", but the provider, model catalogue, and redemption mechanics were not verified.
- **Verified:** the adapter against a local HTTP server implementing `POST /v1/chat/completions`, including retries, timeout, 5xx, JSON-mode fallback, malformed content, and schema validation.
- **Not verified:** a live call to Ollama, OpenRouter, or any other provider. No weights or credentials were available in the build environment.
- Qwen2.5-Coder is documented as the recommended default because it is Apache-2.0 and available locally. Its availability under the event credits is not confirmed.
- No claim is made that any specific model is "fully open source" beyond its own published licence.

## Platform and environment

- Built and tested on **Windows 11, Node 24.21, npm 11.1, Git 2.45**.
- `node:sqlite` requires Node ≥ 22.5. Compatibility with older Node versions is not provided.
- SQLite runs in WAL mode. Two processes (web + MCP) sharing the file is supported on one host; multi-host access is not.
- Docker files were written but **not built** in this environment (no daemon available).
- Playwright Chromium is used for one browser workflow and the README screenshots. It is not a cross-browser matrix.

## Product scope

- Local repositories only. Hosted multi-tenant operation is explicitly out of scope and unimplemented.
- Analysis uses tracked files only. Untracked files are counted in git status but never read into model context.
- A "test gap" is a module whose basename is not referenced by any detected test file. It is not line coverage.
- Security review is a small deterministic rule set plus optional model assessment. It is not a scanner and never proves exploitability.
- Validation commands run as the current OS user without an OS sandbox. Network denial and container isolation are not implemented.

## Deliverables that need the participant

These cannot be completed from this environment and are honestly marked incomplete:

| Deliverable | State |
| --- | --- |
| Public GitHub repository | Source, licence, README, CI, and `.gitignore` are ready; no remote was created or pushed |
| Working public link | Local production build and smoke test pass; no hosting account or tunnel was configured |
| X post with 1–3 min demo | Timed script and synthetic repo are ready; not recorded or posted |
| Submission form | Not submitted |

Do not claim these are done until they are.

## Security assumptions

- The machine and OS user are trusted. A local attacker who can read `.data/` can read the database and the encryption key file.
- The operator will keep ports on loopback or put an authenticated TLS proxy in front of the MCP endpoint.
- The operator will not register repositories they are not authorized to inspect.
- Allowlisted commands run repository scripts with the user's privileges; the operator enables this only for trusted repositories.
- The model is treated as untrusted: repository text can mislead it, and its output is data, never an instruction.