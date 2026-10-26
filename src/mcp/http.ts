import "./loadEnv";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { APP_VERSION } from "@/shared/constants";
import { getConfig } from "../server/config/env";
import { getDb } from "../server/db/client";
import { reapStaleJobs } from "../server/db/analysis";
import { logger } from "../server/observability/logger";
import { createMcpServer } from "./server";

const config = getConfig();

if (!config.mcp.token) {
  console.error(
    "COMMITPILOT_MCP_TOKEN is not set. The MCP connector refuses to start without a bearer token.\n" +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
  );
  process.exit(1);
}

getDb();
const reaped = reapStaleJobs();
if (reaped > 0) {
  logger.warn("stale_jobs_reaped", { count: reaped });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const requestLog: number[] = [];
function rateLimited(): boolean {
  const now = Date.now();
  while (requestLog.length > 0 && now - (requestLog[0] ?? 0) > 60_000) requestLog.shift();
  if (requestLog.length >= 120) return true;
  requestLog.push(now);
  return false;
}

function authorized(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  const expected = config.mcp.token as string;
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < token.length; index += 1) {
    mismatch |= token.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", name: "commitpilot-ai", version: APP_VERSION, transport: "streamable-http" });
});

app.use("/mcp", (req, res, next) => {
  if (rateLimited()) {
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
    return;
  }
  if (!authorized(req.header("authorization"))) {
    logger.warn("mcp_unauthorized", { ip: req.ip });
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid bearer token is required." } });
    return;
  }
  next();
});

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error("mcp_request_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    if (!res.headersSent) {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The MCP request failed." } });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "This stateless MCP endpoint accepts POST only.",
    },
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "No sessions to delete." } });
});

const server = app.listen(config.mcp.port, config.mcp.host, () => {
  logger.info("mcp_server_started", {
    host: config.mcp.host,
    port: config.mcp.port,
    tools: 14,
  });
});

function shutdown(signal: string): void {
  logger.info("mcp_server_stopping", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
