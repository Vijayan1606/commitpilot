import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isContained,
  resolveRepoFile,
  resolveRepositoryPath,
  resolveWorkspaceRoot,
  assertNotDangerousLocation,
} from "@/server/fs/pathGuard";
import { makeScratchDir, makeTempRepo } from "../helpers";

describe("workspace containment", () => {
  it("accepts a repository inside the workspace root", async () => {
    const repo = makeTempRepo({ "README.md": "# hi\n" }, "inside");
    const resolved = await resolveRepositoryPath(process.env.COMMITPILOT_WORKSPACE_ROOT as string, repo);
    expect(path.resolve(resolved)).toBe(path.resolve(repo));
  });

  it("rejects a repository outside the workspace root", async () => {
    const outside = makeScratchDir("outside");
    fs.mkdirSync(path.join(outside, ".git"));
    await expect(
      resolveRepositoryPath(process.env.COMMITPILOT_WORKSPACE_ROOT as string, outside),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
  });

  it("rejects a directory that is not a git repository", async () => {
    const root = process.env.COMMITPILOT_WORKSPACE_ROOT as string;
    const plain = fs.mkdtempSync(path.join(root, "plain-"));
    await expect(resolveRepositoryPath(root, plain)).rejects.toMatchObject({
      code: "REPOSITORY_INVALID",
    });
  });

  it("rejects path traversal in relative repository paths", async () => {
    const root = process.env.COMMITPILOT_WORKSPACE_ROOT as string;
    await expect(resolveRepositoryPath(root, "../etc")).rejects.toMatchObject({
      code: "REPOSITORY_INVALID",
    });
  });

  it("rejects a missing workspace root", async () => {
    await expect(resolveWorkspaceRoot(path.join(makeScratchDir("missing"), "nope"))).rejects.toMatchObject({
      code: "PATH_REJECTED",
    });
  });

  it("rejects a filesystem root as a workspace", () => {
    expect(() => assertNotDangerousLocation(path.parse(process.cwd()).root)).toThrow();
  });

  it("uses a real containment check rather than a string prefix", () => {
    const parent = path.join(makeScratchDir("prefix"), "repo");
    fs.mkdirSync(parent, { recursive: true });
    const sibling = `${parent}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    expect(isContained(parent, sibling)).toBe(false);
    expect(isContained(parent, path.join(parent, "src"))).toBe(true);
  });
});

describe("repository file resolution", () => {
  it("resolves a normal relative path", async () => {
    const repo = makeTempRepo({ "src/index.ts": "export const x = 1;\n" }, "files");
    const resolved = await resolveRepoFile(repo, "src/index.ts");
    expect(fs.readFileSync(resolved, "utf8")).toContain("export const x");
  });

  it("rejects traversal", async () => {
    const repo = makeTempRepo({ "a.txt": "a\n" }, "traversal");
    await expect(resolveRepoFile(repo, "../outside.txt")).rejects.toMatchObject({ code: "PATH_REJECTED" });
    await expect(resolveRepoFile(repo, "src/../../outside.txt")).rejects.toMatchObject({
      code: "PATH_REJECTED",
    });
  });

  it("rejects absolute paths and Windows drive paths", async () => {
    const repo = makeTempRepo({ "a.txt": "a\n" }, "absolute");
    await expect(resolveRepoFile(repo, "/etc/passwd")).rejects.toMatchObject({ code: "PATH_REJECTED" });
    await expect(resolveRepoFile(repo, "C:\\Windows\\win.ini")).rejects.toMatchObject({
      code: "PATH_REJECTED",
    });
  });

  it("rejects a symlink that escapes the repository", async () => {
    const repo = makeTempRepo({ "a.txt": "a\n" }, "symlink");
    const outside = makeScratchDir("escape");
    fs.writeFileSync(path.join(outside, "secret.txt"), "top secret\n");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    fs.symlinkSync(outside, path.join(repo, "escape"), linkType);
    await expect(resolveRepoFile(repo, "escape/secret.txt")).rejects.toMatchObject({
      code: "PATH_OUTSIDE_WORKSPACE",
    });
  });

  it("rejects Windows device names", async () => {
    if (process.platform !== "win32") return;
    const repo = makeTempRepo({ "a.txt": "a\n" }, "device");
    await expect(resolveRepoFile(repo, "CON")).rejects.toMatchObject({ code: "PATH_REJECTED" });
  });
});
