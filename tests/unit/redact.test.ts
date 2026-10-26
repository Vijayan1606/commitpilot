import { describe, expect, it } from "vitest";
import { redactSecrets, redactValue, scanForSecrets } from "@/server/observability/redact";
import { EXAMPLE_AWS_KEY } from "../helpers";

const FAKE_GITHUB_TOKEN = "gh" + "p_abcdefghijklmnopqrstuvwxyz0123456789";
const PRIVATE_KEY_BEGIN = "-----BEGIN RSA " + "PRIVATE KEY-----";
const PRIVATE_KEY_END = "-----END RSA " + "PRIVATE KEY-----";

describe("secret redaction", () => {
  it("redacts AWS keys, GitHub tokens, and bearer tokens", () => {
    const input = `key=${EXAMPLE_AWS_KEY} token=${FAKE_GITHUB_TOKEN} header=Bearer abcdefghijklmnopqrstuvwxyz123456`;
    const output = redactSecrets(input);
    expect(output).not.toContain(EXAMPLE_AWS_KEY);
    expect(output).not.toContain(FAKE_GITHUB_TOKEN);
    expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts assigned secrets while keeping the key name", () => {
    const output = redactSecrets('apiKey = "sk-live-supersecretvalue"');
    expect(output).toContain("apiKey");
    expect(output).not.toContain("supersecretvalue");
  });

  it("redacts private key blocks", () => {
    const block = `${PRIVATE_KEY_BEGIN}\nMIIEow\n${PRIVATE_KEY_END}`;
    expect(redactSecrets(block)).not.toContain("MIIEow");
  });

  it("leaves ordinary code intact", () => {
    const code = "const token = request.headers.authorization;\nif (!token) return 401;";
    expect(redactSecrets(code)).toBe(code);
  });

  it("scans line by line without returning the secret", () => {
    const matches = scanForSecrets(`line one\nAWS_ACCESS_KEY_ID=${EXAMPLE_AWS_KEY}\nline three\n`);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.line).toBe(2);
    expect(matches[0]?.preview).not.toContain(EXAMPLE_AWS_KEY);
  });

  it("redacts sensitive object keys recursively", () => {
    const result = redactValue({
      apiKey: "abc",
      nested: { password: "hunter2", safe: "hello" },
      list: [{ token: "xyz" }],
    }) as Record<string, unknown>;
    expect(result.apiKey).toBe("[REDACTED]");
    expect((result.nested as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((result.nested as Record<string, unknown>).safe).toBe("hello");
  });
});
