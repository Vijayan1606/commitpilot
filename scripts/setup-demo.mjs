#!/usr/bin/env node
/**
 * Create the synthetic demo repository inside the configured workspace root.
 *
 * Usage:
 *   node scripts/setup-demo.mjs [--force]
 *
 * The repository is written to <workspace>/commitpilot-sample, initialised with
 * Git, and left with one uncommitted regression so the review workflow has a
 * real diff to inspect.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

try {
  if (fs.existsSync(path.resolve(process.cwd(), ".env"))) {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  }
} catch {
  // Explicit environment variables still work.
}

const projectRoot = process.cwd();
const workspaceRoot = path.resolve(
  projectRoot,
  process.env.COMMITPILOT_WORKSPACE_ROOT ?? "./.workspaces",
);
const target = path.join(workspaceRoot, "commitpilot-sample");
const source = path.join(projectRoot, "demo", "sample-repo");
const force = process.argv.includes("--force");

function git(args) {
  return execFileSync(
    "git",
    ["-C", target, "-c", "user.name=CommitPilot Demo", "-c", "user.email=demo@commitpilot.local", ...args],
    { encoding: "utf8", windowsHide: true },
  );
}

if (!fs.existsSync(source)) {
  console.error(`Demo fixture missing: ${source}`);
  process.exit(1);
}

if (fs.existsSync(target)) {
  if (!force) {
    console.error(`Refusing to overwrite ${target}. Re-run with --force to recreate it.`);
    process.exit(1);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

fs.mkdirSync(workspaceRoot, { recursive: true });
fs.cpSync(source, target, { recursive: true });

git(["init", "-q"]);
git(["config", "core.autocrlf", "false"]);
git(["add", "-A"]);
git(["commit", "-q", "-m", "Initial demo repository"]);

// Leave one real, uncommitted regression for the review workflow.
const sessionFile = path.join(target, "src", "auth", "session.js");
const original = fs.readFileSync(sessionFile, "utf8");
fs.writeFileSync(
  sessionFile,
  original.replace(
    "if (!payload) return null;",
    'if (!payload) return { userId: "anonymous" };',
  ),
  "utf8",
);

console.log("");
console.log("Demo repository ready.");
console.log(`  path: ${target}`);
console.log("  working tree: dirty (one uncommitted regression in src/auth/session.js)");
console.log("");
console.log("Register it in CommitPilot with this path:");
console.log(`  ${target}`);
console.log("");