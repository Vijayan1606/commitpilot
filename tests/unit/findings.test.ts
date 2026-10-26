import { describe, expect, it } from "vitest";
import { verifyFindings } from "@/server/analysis/findings";
import type { ModelFinding } from "@/server/models/types";
import { EXAMPLE_AWS_KEY, makeTempRepo } from "../helpers";

function finding(overrides: Partial<ModelFinding> = {}): ModelFinding {
  return {
    category: "correctness",
    severity: "medium",
    title: "Example",
    description: "Example description",
    evidence: "line of evidence",
    filePath: "src/a.ts",
    startLine: 1,
    endLine: 1,
    confidence: "medium",
    remediation: "Fix it",
    ...overrides,
  };
}

describe("finding verification", () => {
  it("marks an existing path as path-verified but never as confirmed", async () => {
    const repo = makeTempRepo({ "src/a.ts": "one\ntwo\nthree\n" }, "verify");
    const result = await verifyFindings(repo, new Set(["src/a.ts"]), [finding()], {
      maxFileBytes: 100_000,
      userExclusions: [],
      source: "model",
    });
    expect(result.findings[0]?.verificationStatus).toBe("path_verified_model_hypothesis");
    expect(result.findings[0]?.filePath).toBe("src/a.ts");
  });

  it("strips a file path that is not tracked", async () => {
    const repo = makeTempRepo({ "src/a.ts": "one\n" }, "verify-missing");
    const result = await verifyFindings(
      repo,
      new Set(["src/a.ts"]),
      [finding({ filePath: "src/imaginary.ts" })],
      { maxFileBytes: 100_000, userExclusions: [], source: "model" },
    );
    expect(result.findings[0]?.filePath).toBeNull();
    expect(result.findings[0]?.startLine).toBeNull();
    expect(result.findings[0]?.verificationStatus).toBe("unverified_model_hypothesis");
    expect(result.invalidPaths).toBe(1);
  });

  it("downgrades line numbers beyond the end of the file", async () => {
    const repo = makeTempRepo({ "src/a.ts": "one\n" }, "verify-lines");
    const result = await verifyFindings(
      repo,
      new Set(["src/a.ts"]),
      [finding({ startLine: 400, endLine: 420 })],
      { maxFileBytes: 100_000, userExclusions: [], source: "model" },
    );
    expect(result.findings[0]?.startLine).toBeNull();
    expect(result.findings[0]?.verificationStatus).toBe("needs_manual_verification");
    expect(result.invalidLines).toBe(1);
  });

  it("keeps static rule findings labelled as static", async () => {
    const repo = makeTempRepo({ "src/a.ts": "eval(x)\n" }, "verify-static");
    const result = await verifyFindings(
      repo,
      new Set(["src/a.ts"]),
      [finding({ title: "Dynamic eval", evidence: "eval(x)" })],
      { maxFileBytes: 100_000, userExclusions: [], source: "static_rule" },
    );
    expect(result.findings[0]?.verificationStatus).toBe("static_rule_match");
    expect(result.findings[0]?.source).toBe("static_rule");
  });

  it("removes duplicate findings and redacts secrets in evidence", async () => {
    const repo = makeTempRepo({ "src/a.ts": "one\n" }, "verify-dedupe");
    const result = await verifyFindings(
      repo,
      new Set(["src/a.ts"]),
      [
        finding({ evidence: `key=${EXAMPLE_AWS_KEY}` }),
        finding({ evidence: "duplicate" }),
      ],
      { maxFileBytes: 100_000, userExclusions: [], source: "model" },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.findings[0]?.evidence).not.toContain(EXAMPLE_AWS_KEY);
  });
});
