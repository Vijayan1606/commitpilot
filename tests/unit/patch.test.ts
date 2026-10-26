import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyPatch, assertPatchShape, extractPatchPaths, validatePatch } from "@/server/patches/patch";
import { gitExec, makeTempRepo } from "../helpers";

const baseDiff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-export const a = 1;
+export const a = 2;
`;

function repoWithChange(): { repo: string; diff: string } {
  const repo = makeTempRepo({ "src/a.ts": "export const a = 1;\n" }, "patch");
  fs.writeFileSync(path.join(repo, "src/a.ts"), "export const a = 2;\n");
  const diff = gitExec(repo, ["diff"]);
  gitExec(repo, ["checkout", "--", "src/a.ts"]);
  return { repo, diff };
}

describe("patch shape validation", () => {
  it("accepts a well-formed single-file diff", () => {
    expect(assertPatchShape(baseDiff)).toEqual(["src/a.ts"]);
    expect(extractPatchPaths(baseDiff)).toEqual(["src/a.ts"]);
  });

  it("rejects empty and oversized diffs", () => {
    expect(() => assertPatchShape("   ")).toThrow();
    expect(() => assertPatchShape(baseDiff + "x".repeat(250_000))).toThrow();
  });

  it("rejects new, deleted, renamed, and binary changes", () => {
    const variants = [
      baseDiff.replace("--- a/src/a.ts", "--- /dev/null").replace("+++ b/src/a.ts", "+++ b/src/new.ts"),
      baseDiff.replace("@@ -1,1 +1,1 @@", "deleted file mode 100644\n@@ -1,1 +0,0 @@"),
      baseDiff.replace("diff --git a/src/a.ts b/src/a.ts", "diff --git a/src/a.ts b/src/b.ts\nrename from src/a.ts\nrename to src/b.ts"),
      baseDiff + "GIT binary patch\n",
      baseDiff.replace("@@ -1,1 +1,1 @@", "new file mode 100644\n@@ -1,1 +1,1 @@"),
    ];
    for (const variant of variants) {
      expect(() => assertPatchShape(variant), variant.slice(0, 80)).toThrow();
    }
  });

  it("rejects absolute and traversing paths", () => {
    for (const bad of [
      baseDiff.replace("--- a/src/a.ts", "--- /etc/passwd").replace("+++ b/src/a.ts", "+++ /etc/passwd"),
      baseDiff.replace(/a\/src\/a\.ts/g, "a/../secret").replace(/b\/src\/a\.ts/g, "b/../secret"),
      baseDiff.replace(/a\/src\/a\.ts/g, "a/C:\\Windows\\win.ini").replace(/b\/src\/a\.ts/g, "b/C:\\Windows\\win.ini"),
    ]) {
      expect(() => assertPatchShape(bad)).toThrow();
    }
  });
});

describe("patch validation and application", () => {
  afterEach(() => {
    process.env.COMMITPILOT_ALLOW_PATCH_APPLY = "false";
  });

  it("validates a real diff against the repository", async () => {
    const { repo, diff } = repoWithChange();
    const validation = await validatePatch(repo, diff, { maxFiles: 100, userExclusions: [] });
    expect(validation.ok).toBe(true);
    expect(validation.appliesCleanly).toBe(true);
    expect(validation.filesTouched).toEqual(["src/a.ts"]);
  });

  it("rejects a diff whose context no longer matches", async () => {
    const { repo, diff } = repoWithChange();
    const broken = diff.replace("-export const a = 1;", "-export const a = 999;");
    const validation = await validatePatch(repo, broken, { maxFiles: 100, userExclusions: [] });
    expect(validation.ok).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it("rejects a diff that touches an untracked path", async () => {
    const { repo } = repoWithChange();
    const diff = baseDiff.replace(/src\/a\.ts/g, "src/missing.ts");
    const validation = await validatePatch(repo, diff, { maxFiles: 100, userExclusions: [] });
    expect(validation.ok).toBe(false);
  });

  it("refuses to apply when the server flag is off", async () => {
    const { repo, diff } = repoWithChange();
    await expect(
      applyPatch(repo, "patch_test", diff, { maxFiles: 100, userExclusions: [] }),
    ).rejects.toMatchObject({ code: "PATCH_APPLY_DISABLED" });
  });

  it("applies an approved patch and leaves a backup", async () => {
    process.env.COMMITPILOT_ALLOW_PATCH_APPLY = "true";
    const { repo, diff } = repoWithChange();
    const result = await applyPatch(repo, "patch_test_apply", diff, {
      maxFiles: 100,
      userExclusions: [],
    });
    expect(fs.readFileSync(path.join(repo, "src/a.ts"), "utf8")).toContain("a = 2");
    expect(result.backupDirectory).toBeTruthy();
    expect(fs.existsSync(path.join(result.backupDirectory as string, "src", "a.ts"))).toBe(true);
  });

  it("does not modify files when a patch is rejected", async () => {
    const { repo, diff } = repoWithChange();
    const broken = diff.replace("-export const a = 1;", "-export const a = 999;");
    const validation = await validatePatch(repo, broken, { maxFiles: 100, userExclusions: [] });
    expect(validation.ok).toBe(false);
    expect(fs.readFileSync(path.join(repo, "src/a.ts"), "utf8")).toContain("a = 1");
  });
});
