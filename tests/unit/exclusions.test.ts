import { describe, expect, it } from "vitest";
import { evaluatePath, isBinaryExtension, looksBinaryContent } from "@/server/fs/exclusions";

describe("path exclusions", () => {
  it("always excludes secret files", () => {
    for (const file of [
      ".env",
      ".env.local",
      "config/.env.production",
      "keys/server.pem",
      "certs/private.key",
      "id_rsa",
      "credentials.json",
      "secrets.yaml",
      "service-account-prod.json",
      ".aws/credentials",
      ".ssh/id_ed25519",
      "credentials/prod.json",
      "secrets/db.txt",
      "config/private/token.txt",
    ]) {
      expect(evaluatePath(file).excluded, file).toBe(true);
    }
  });

  it("always excludes dependency and build directories", () => {
    for (const file of [
      "node_modules/express/index.js",
      ".git/config",
      "dist/bundle.js",
      "build/out.o",
      ".next/server/page.js",
      "vendor/lib.php",
      "__pycache__/x.pyc",
    ]) {
      expect(evaluatePath(file).excluded, file).toBe(true);
    }
  });

  it("keeps ordinary source and documentation files", () => {
    for (const file of ["src/app.ts", "README.md", "docs/notes.md", "src/auth/session.test.ts"]) {
      expect(evaluatePath(file).excluded, file).toBe(false);
    }
  });

  it("applies user exclusions as prefixes, segments, and globs", () => {
    expect(evaluatePath("docs/internal/plan.md", ["docs/internal"]).excluded).toBe(true);
    expect(evaluatePath("src/__snapshots__/a.snap", ["*.snap"]).excluded).toBe(true);
    expect(evaluatePath("fixtures/data.json", ["fixtures"]).excluded).toBe(true);
    expect(evaluatePath("src/app.ts", ["fixtures"]).excluded).toBe(false);
  });

  it("cannot be told to include a secret file through user configuration", () => {
    expect(evaluatePath(".env", ["!.env", ".env"]).excluded).toBe(true);
    expect(evaluatePath(".env", []).reason).toBe("mandatory_secret");
  });

  it("detects binary extensions and content", () => {
    expect(isBinaryExtension("logo.png")).toBe(true);
    expect(isBinaryExtension("src/app.ts")).toBe(false);
    expect(looksBinaryContent(Buffer.from([0x00, 0x01, 0x02]))).toBe(true);
    expect(looksBinaryContent(Buffer.from("plain text"))).toBe(false);
  });
});
