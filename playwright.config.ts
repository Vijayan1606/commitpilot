import { defineConfig, devices } from "@playwright/test";

const workspaceRoot =
  process.platform === "win32"
    ? "C:\\commitpilot-demo\\workspaces"
    : "/tmp/commitpilot-demo/workspaces";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3101",
    ...devices["Desktop Chrome"],
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3101",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      COMMITPILOT_WORKSPACE_ROOT: workspaceRoot,
      COMMITPILOT_DATA_DIR: ".data-e2e",
      COMMITPILOT_DB_PATH: ".data-e2e/e2e.db",
      COMMITPILOT_LOG_LEVEL: "error",
      OPENMODEL_BASE_URL: "",
      OPENMODEL_MODEL: "",
      OPENMODEL_API_KEY: "",
    },
  },
});