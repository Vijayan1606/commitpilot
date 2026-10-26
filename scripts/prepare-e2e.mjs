#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const workspaceRoot =
  process.platform === "win32"
    ? "C:\\commitpilot-demo\\workspaces"
    : "/tmp/commitpilot-demo/workspaces";

fs.rmSync(path.resolve("test-results"), { recursive: true, force: true });
fs.rmSync(path.resolve(".data-e2e"), { recursive: true, force: true });
execFileSync(process.execPath, ["scripts/setup-demo.mjs", "--force"], {
  stdio: "inherit",
  env: { ...process.env, COMMITPILOT_WORKSPACE_ROOT: workspaceRoot },
});