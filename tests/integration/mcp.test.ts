import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRepository } from "@/server/db/repositories";
import { makeTempRepo, SAMPLE_FILES } from "../helpers";

const TOKEN = "mcp-test-token-0123456789";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("The MCP server did not become healthy in time.");
}

let child: ChildProcess | undefined;
let baseUrl = "";
let client: Client | undefined;
let repositoryId = "";

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  repositoryId = createRepository("mcp-sample", makeTempRepo(SAMPLE_FILES, "mcp")).id;

  child = spawn(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("src", "mcp", "http.ts")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COMMITPILOT_MCP_HOST: "127.0.0.1",
        COMMITPILOT_MCP_PORT: String(port),
        COMMITPILOT_MCP_TOKEN: TOKEN,
        COMMITPILOT_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stderr?.on("data", () => undefined);
  child.stdout?.on("data", () => undefined);

  await waitForHealth(baseUrl);

  client = new Client({ name: "commitpilot-integration-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close().catch(() => undefined);
  child?.kill();
});

describe("Alan MCP connector (streamable HTTP)", () => {
  it("rejects a request without a bearer token", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  it("exposes the required tool set to an MCP client", async () => {
    const tools = await client!.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const required of [
      "inspect_repository",
      "analyze_repository",
      "review_git_changes",
      "search_code",
      "analyze_test_gaps",
      "propose_patch",
      "get_analysis_report",
    ]) {
      expect(names, required).toContain(required);
    }
    const analyze = tools.tools.find((tool) => tool.name === "analyze_repository");
    expect(analyze?.description).toContain("open model");
    expect(analyze?.inputSchema).toBeTruthy();
    expect(analyze?.annotations?.readOnlyHint).toBe(true);
  });

  it("calls a read-only tool and returns structured results", async () => {
    const result = await client!.callTool({ name: "list_repositories", arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
    const payload = JSON.parse(text) as { repositories: { id: string; name: string }[] };
    expect(payload.repositories.some((repository) => repository.id === repositoryId)).toBe(true);
  });

  it("returns a structured error for an unknown tool", async () => {
    const result = await client!.callTool({ name: "delete_everything", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    // The MCP layer rejects unknown tool names before dispatch, which is the
    // behaviour we want: the registry can never be reached by an invented name.
    expect(text.toLowerCase()).toContain("not found");
  });

  it("inspects a registered repository over the wire", async () => {
    const result = await client!.callTool({
      name: "inspect_repository",
      arguments: { repositoryId, includeFiles: true },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
    const payload = JSON.parse(text) as {
      overview: { frameworks: string[]; fileCount: number };
      files: string[];
    };
    expect(payload.overview.frameworks).toContain("Express");
    expect(payload.files).toContain("src/auth/session.ts");
    expect(payload.files).not.toContain(".env");
  });

  it("requires confirmation before a destructive tool runs", async () => {
    const result = await client!.callTool({
      name: "apply_patch",
      arguments: { patchId: "patch_nope", approve: true, confirm: false },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
    const payload = JSON.parse(text) as { error: { code: string } };
    expect(payload.error.code).toBe("TOOL_FORBIDDEN");
  });
});