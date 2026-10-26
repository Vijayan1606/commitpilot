import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry, defineTool, type ToolDefinition } from "@/server/tools/registry";

function buildRegistry(): ToolRegistry {
  const definitions: ToolDefinition[] = [
    defineTool({
      name: "echo",
      title: "Echo",
      description: "Echo the input",
      inputSchema: z.object({ value: z.string().min(1) }),
      outputSchema: z.object({ value: z.string() }),
      risk: "read",
      handler: async (input) => ({ value: input.value }),
    }),
    defineTool({
      name: "slow",
      title: "Slow",
      description: "Never finishes in time",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      risk: "read",
      timeoutMs: 30,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { ok: true };
      },
    }),
    defineTool({
      name: "huge",
      title: "Huge",
      description: "Returns too much",
      inputSchema: z.object({}),
      outputSchema: z.record(z.unknown()),
      risk: "read",
      handler: async () => ({ blob: "x".repeat(2_100_000) }),
    }),
    defineTool({
      name: "bad-shape",
      title: "Bad shape",
      description: "Returns an unexpected shape",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      risk: "read",
      handler: async () => ({ ok: "not-a-boolean" }),
    }),
    defineTool({
      name: "mutate",
      title: "Mutate",
      description: "Requires confirmation",
      inputSchema: z.object({ confirm: z.boolean().optional() }),
      outputSchema: z.object({ ok: z.boolean() }),
      risk: "write",
      sideEffects: true,
      requiresConfirmation: true,
      handler: async () => ({ ok: true }),
    }),
  ];
  return new ToolRegistry(definitions);
}

const context = { surface: "web" as const, correlationId: "test-correlation" };

describe("tool registry", () => {
  it("rejects unknown tools", async () => {
    const registry = buildRegistry();
    await expect(registry.dispatch("nope", {}, context)).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
  });

  it("rejects malformed arguments", async () => {
    const registry = buildRegistry();
    await expect(registry.dispatch("echo", { value: 5 }, context)).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
    await expect(registry.dispatch("echo", { value: "" }, context)).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
  });

  it("returns structured output for valid input", async () => {
    const registry = buildRegistry();
    await expect(registry.dispatch("echo", { value: "hello" }, context)).resolves.toEqual({ value: "hello" });
  });

  it("blocks side effects without explicit confirmation", async () => {
    const registry = buildRegistry();
    await expect(registry.dispatch("mutate", {}, context)).rejects.toMatchObject({ code: "TOOL_FORBIDDEN" });
    await expect(registry.dispatch("mutate", { confirm: true }, context)).resolves.toEqual({ ok: true });
  });

  it("enforces tool timeouts", async () => {
    const registry = buildRegistry();
    await expect(registry.dispatch("slow", {}, context)).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
  });

  it("enforces the output size limit", async () => {
    const registry = buildRegistry();
    await expect(registry.dispatch("huge", {}, context)).rejects.toMatchObject({
      code: "TOOL_OUTPUT_TOO_LARGE",
    });
  });

  it("validates the output shape", async () => {
    const registry = buildRegistry();
    await expect(registry.dispatch("bad-shape", {}, context)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});
