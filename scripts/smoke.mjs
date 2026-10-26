#!/usr/bin/env node
/**
 * Runtime smoke test against a production build.
 *
 * Starts `next start` with an isolated database, registers the synthetic demo
 * repository through the public API, and exercises the read-only workflows that
 * do not need a model. Exits non-zero if any check fails.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const projectRoot = process.cwd();
const workspaceRoot = path.resolve(projectRoot, ".workspaces");
const dataDir = path.resolve(projectRoot, ".data-smoke");

execFileSync(process.execPath, ["scripts/setup-demo.mjs", "--force"], {
  stdio: "inherit",
  env: process.env,
});

fs.rmSync(dataDir, { recursive: true, force: true });

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const chosen = typeof address === "object" && address ? address.port : 0;
    server.close(() => resolve(chosen));
  });
});

const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      COMMITPILOT_WORKSPACE_ROOT: workspaceRoot,
      COMMITPILOT_DATA_DIR: dataDir,
      COMMITPILOT_DB_PATH: path.join(dataDir, "smoke.db"),
      COMMITPILOT_LOG_LEVEL: "warn",
      OPENMODEL_BASE_URL: "",
      OPENMODEL_MODEL: "",
      OPENMODEL_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += String(chunk).slice(-4000);
});
server.stderr.on("data", (chunk) => {
  serverOutput += String(chunk).slice(-4000);
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return response;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("The web server did not become healthy.");
}

async function json(pathname, init) {
  const response = await fetch(`${base}${pathname}`, init);
  const body = await response.json();
  return { response, body };
}

try {
  const health = await waitForServer();
  const healthBody = await health.json();
  check("health endpoint", health.status === 200 && healthBody.database === "ok");

  const demoPath = path.join(workspaceRoot, "commitpilot-sample");
  const registered = await json("/api/repositories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: demoPath }),
  });
  check("register demo repository", registered.response.status === 201);
  const repositoryId = registered.body.repository?.id;

  const pages = ["/", "/repositories", `/repositories/${repositoryId}`, "/settings", "/reports", "/patches", "/reviews"];
  for (const page of pages) {
    const response = await fetch(`${base}${page}`);
    const html = await response.text();
    check(`page ${page}`, response.status === 200 && html.includes("CommitPilot"), `status ${response.status}`);
  }

  const home = await fetch(`${base}/`);
  check("security headers", home.headers.get("x-content-type-options") === "nosniff");

  const files = await json(`/api/repositories/${repositoryId}/files`);
  check(
    "tracked file listing excludes secrets",
    files.body.files?.includes("src/auth/session.js") && !files.body.files?.includes(".env.example"),
  );

  const search = await json("/api/searches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryId, query: "verifySession", summarize: false }),
  });
  check(
    "natural-language search returns real files",
    search.body.files?.some((file) => file.path === "src/auth/session.js"),
  );

  const preview = await json("/api/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryId, type: "repository_analysis" }),
  });
  check(
    "context preview lists bounded evidence",
    Array.isArray(preview.body.files) && preview.body.files.length > 0,
  );

  const started = await json("/api/analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryId, type: "security_review" }),
  });
  check("security review starts", started.response.status === 202);

  const jobId = started.body.job?.id;
  let detail = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const current = await json(`/api/analyses/${jobId}`);
    detail = current.body;
    if (["completed", "failed", "cancelled"].includes(detail.job?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  check(
    "security review completes deterministically",
    detail?.job?.status === "completed" && detail?.findings?.length > 0,
    detail?.job?.status,
  );
  check(
    "finding carries evidence and verification status",
    Boolean(detail?.findings?.[0]?.evidence) && detail?.findings?.[0]?.verificationStatus === "static_rule_match",
  );

  const reportId = detail?.report?.id;
  if (reportId) {
    const exported = await fetch(`${base}/api/reports/${reportId}/export?format=md`);
    const markdown = await exported.text();
    check(
      "markdown export",
      exported.status === 200 && markdown.includes("Verification legend"),
      `${markdown.length} bytes`,
    );
    const exportedJson = await fetch(`${base}/api/reports/${reportId}/export?format=json`);
    const jsonBody = await exportedJson.json();
    check("json export", exportedJson.status === 200 && Array.isArray(jsonBody.findings));
  } else {
    check("report was saved", false, "no report id");
  }

  const settings = await json("/api/settings");
  check(
    "settings never return a credential",
    settings.response.status === 200 && !JSON.stringify(settings.body).includes("apiKey"),
  );

  const unauthenticated = await fetch(`${base}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryId: "repo_missing", type: "repository_analysis" }),
  });
  check("unknown repository rejected", unauthenticated.status === 404);
} catch (error) {
  check(`smoke run completed without an exception`, false, error instanceof Error ? error.message : String(error));
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const failed = results.filter((result) => !result.ok);
console.log("");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("");
  console.log(serverOutput.split("\n").slice(-30).join("\n"));
  process.exit(1);
}
process.exit(0);