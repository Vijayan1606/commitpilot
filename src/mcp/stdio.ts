import "./loadEnv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../server/db/client";
import { reapStaleJobs } from "../server/db/analysis";
import { createMcpServer } from "./server";

async function main(): Promise<void> {
  getDb();
  reapStaleJobs();
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for the protocol; diagnostics go to stderr.
  console.error("CommitPilot MCP server running on stdio.");
}

main().catch((error: unknown) => {
  console.error("CommitPilot MCP stdio server failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
