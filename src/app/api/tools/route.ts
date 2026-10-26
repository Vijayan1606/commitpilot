import { jsonOk } from "@/server/http/handler";
import { toolRegistry } from "@/server/tools";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return jsonOk({
    tools: toolRegistry.list().map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      risk: tool.risk,
      sideEffects: tool.sideEffects,
      requiresConfirmation: tool.requiresConfirmation,
      annotations: tool.annotations,
    })),
  });
}
