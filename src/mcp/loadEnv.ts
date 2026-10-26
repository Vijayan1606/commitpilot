import fs from "node:fs";
import path from "node:path";

/**
 * The web app loads .env.local/.env through Next.js. The standalone MCP
 * process does not, so load the project .env before configuration is read.
 * Import this module first in every MCP entry point.
 */
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
} catch {
  // A missing or malformed .env is not fatal: explicit environment variables
  // still work, and the token check below reports the actionable error.
}