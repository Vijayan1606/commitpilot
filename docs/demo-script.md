# Demo script (2 minutes)

Goal: show a real repository, real evidence, and the approval gate. Do not read feature lists aloud; show the workflow.

## Pre-flight (before recording)

1. `npm run demo:setup -- --force` — creates the synthetic repo and leaves one uncommitted regression.
2. Confirm `.env.local` and `.env` point at a working open model. Test it once with **Settings → Check provider**.
3. `npm run dev` and `npm run mcp`.
4. Register the path printed by the setup script.
5. Open the dashboard, a second tab on the repository, and a third on Alan with the connector already added.
6. Keep a previously generated report open in a fourth tab as a fallback. If you show it, say it is a recorded run.
7. Close notifications, terminals with secrets, and unrelated tabs.

## Script

| Time | Screen | Say / do |
| --- | --- | --- |
| 0:00–0:12 | Dashboard | "CommitPilot is an open-source repository assistant for Alan. It reads a real Git repo, sends bounded evidence to an open model, and labels every finding by how it was verified." |
| 0:12–0:25 | Repositories | "I registered a local synthetic repo. Nothing outside this workspace can be registered — the server resolves symlinks and enforces containment on every read." |
| 0:25–0:42 | Repository page | Scroll the stack signals, branch, dirty tree, and file list. "This is deterministic inspection, not model output. `.env` and dependency folders never appear." |
| 0:42–1:00 | Alan | Ask: *"Inspect the taskflow repo and analyze its authentication module. Find likely bugs."* Switch to the analysis page while it runs. Point at the stage/progress, then the findings. |
| 1:00–1:18 | Analysis | Open one finding. "It cites `src/auth/session.js`, quotes the line, and says `path verified · AI`. That means the file exists; the claim is still a hypothesis. Static rule matches are labelled separately, and nothing is called a confirmed vulnerability." |
| 1:18–1:32 | Alan | Ask: *"Review my current uncommitted changes."* Open the review. "This is a real `git diff`. The regression — invalid tokens becoming an anonymous session — is in the changed lines." |
| 1:32–1:55 | Patch | Ask for a fix, open the patch, show `git apply --check` passed, then **Reject**. "Files are unchanged. Approval is a separate action, backed up, and gated by a server flag." |
| 1:55–2:10 | Reports | Open the saved report, click **Export .md**. "The report carries evidence, verification status, model, and limitations. No secrets." |
| 2:10–2:20 | GitHub tab | "MIT licensed, CI, tests, and setup instructions. The Alan connector is a standard MCP endpoint with a bearer token." |

## If the model is unavailable

Do **not** pretend it worked.

1. Show the failed job and the error code (`MODEL_UNAVAILABLE` or `MODEL_TIMEOUT`).
2. Say: "The model is unavailable, so the analysis failed instead of inventing findings."
3. Run **Security review**, which is deterministic, and show the SQL-concatenation lead with `static rule` verification.
4. Optionally open a previously generated genuine report and label it clearly: "This is from an earlier real run."

## Do not

- Do not show fake metrics, canned findings, or an edited result.
- Do not cover the terminal where the model endpoint is configured.
- Do not claim the Alan connector was added if it was not.
- Do not claim the patch was applied if you rejected it.