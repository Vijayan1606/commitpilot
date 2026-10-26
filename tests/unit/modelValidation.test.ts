import { describe, expect, it } from "vitest";
import { extractJsonObject, parseAnalysis, parseFinding } from "@/server/models/validation";

describe("model response validation", () => {
  it("extracts JSON from a fenced response", () => {
    const value = extractJsonObject('```json\n{"summary":"ok","findings":[]}\n```');
    expect(value).toEqual({ summary: "ok", findings: [] });
  });

  it("normalises severity and category aliases", () => {
    const analysis = parseAnalysis({
      summary: "Found something.",
      findings: [
        {
          category: "bug",
          severity: "moderate",
          title: "Off by one",
          description: "The loop skips the last element.",
          evidence: "for (i = 0; i < n - 1; i++)",
          filePath: "./src/loop.ts",
          startLine: "12",
          endLine: 11,
          confidence: "sure",
          suggestion: "Iterate while i < n.",
        },
      ],
    });
    expect(analysis.findings[0]).toMatchObject({
      category: "correctness",
      severity: "medium",
      filePath: "src/loop.ts",
      startLine: 12,
      endLine: 12,
      confidence: "low",
    });
  });

  it("drops malformed findings but keeps valid ones", () => {
    const analysis = parseAnalysis({
      summary: "Mixed response.",
      findings: [
        { title: "", description: "no title" },
        { category: "security", severity: "high", title: "Good", description: "valid" },
      ],
    });
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.droppedFindings).toBe(1);
    expect(analysis.rawFindingCount).toBe(2);
  });

  it("rejects a response with no findings array", () => {
    expect(() => parseAnalysis({ summary: "nothing" })).toThrow();
  });

  it("rejects a response where every finding is malformed", () => {
    expect(() => parseAnalysis({ summary: "x", findings: [{ title: 42 }] })).toThrow();
  });

  it("rejects a response without a summary", () => {
    expect(() => parseAnalysis({ findings: [] })).toThrow();
  });

  it("never accepts an absolute or traversing file path", () => {
    expect(parseFinding({ title: "a", description: "b", filePath: "/etc/passwd" })?.filePath).toBeNull();
    expect(parseFinding({ title: "a", description: "b", filePath: "../../secret" })?.filePath).toBeNull();
    expect(parseFinding({ title: "a", description: "b", filePath: "C:\\Windows\\win.ini" })?.filePath).toBeNull();
  });

  it("clamps impossible line numbers to null", () => {
    expect(parseFinding({ title: "a", description: "b", startLine: -4 })?.startLine).toBeNull();
    expect(parseFinding({ title: "a", description: "b", startLine: 999999999 })?.startLine).toBeNull();
  });
});
