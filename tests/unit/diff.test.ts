import { describe, expect, it } from "vitest";
import { assertSafeCommitRange, parseUnifiedDiff } from "@/server/git/git";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a, b };
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1,2 @@
+# Title
+Body
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const old = true;
`;

describe("unified diff parsing", () => {
  it("summarises modified, added, and deleted files", () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ path: "src/a.ts", status: "modified", additions: 2, deletions: 1 });
    expect(files[1]).toMatchObject({ path: "docs/new.md", status: "added" });
    expect(files[2]).toMatchObject({ path: "src/old.ts", status: "deleted" });
  });

  it("returns nothing for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

describe("commit range validation", () => {
  it("accepts ordinary ranges", () => {
    expect(assertSafeCommitRange("main..HEAD")).toBe("main..HEAD");
    expect(assertSafeCommitRange("abc123")).toBe("abc123");
    expect(assertSafeCommitRange("HEAD~3..HEAD")).toBe("HEAD~3..HEAD");
  });

  it("rejects option injection and malformed ranges", () => {
    for (const range of ["--stat", "-p", "main..HEAD..x", "main; rm -rf /", "a b", "main..HEAD -- output"]) {
      expect(() => assertSafeCommitRange(range), range).toThrow();
    }
  });
});
