import test from "node:test";
import assert from "node:assert/strict";
import { verifySession } from "../src/auth/session.js";

function tokenWith(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64")}.signature`;
}

test("accepts a token with a user id", () => {
  const session = verifySession(tokenWith({ userId: "u_1" }));
  assert.equal(session.userId, "u_1");
});

// The expiry branch has no test at all, which is one of the demo findings.