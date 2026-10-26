import { jsonOk } from "@/server/http/handler";
import { getConfig } from "@/server/config/env";
import { toolRegistry } from "@/server/tools";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = getConfig();
  const baseUrl = config.mcp.publicUrl ?? `http://${config.mcp.host}:${config.mcp.port}`;
  const url = `${baseUrl}/mcp`;
  return jsonOk({
    url,
    transport: "streamable-http",
    tokenConfigured: Boolean(config.mcp.token),
    tools: toolRegistry.list().length,
    genericClientConfig: {
      mcpServers: {
        commitpilot: {
          type: "http",
          url,
          headers: {
            Authorization: "Bearer <COMMITPILOT_MCP_TOKEN>",
          },
        },
      },
    },
    note: "Add this URL as a custom MCP connector in Alan (Settings → Plugins → MCP → Add custom connector) and supply the bearer token. The token is never shown in the UI.",
  });
}
