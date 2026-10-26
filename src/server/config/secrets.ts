import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./env";
import { AppError } from "../errors";

const KEY_FILE = "secret.key";

function loadKey(): Buffer {
  const { appSecret, dataDir } = getConfig();
  if (appSecret) {
    return crypto.createHash("sha256").update(appSecret, "utf8").digest();
  }
  const keyPath = path.join(dataDir, KEY_FILE);
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const stored = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "base64");
    if (stored.length !== 32) throw new Error("invalid key length");
    return stored;
  } catch {
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, generated.toString("base64"), { mode: 0o600 });
    return generated;
  }
}

export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptString(payload: string): string {
  try {
    const buffer = Buffer.from(payload, "base64");
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(
      "CONFIG_INVALID",
      "The stored model credential could not be decrypted. Re-enter it in Settings.",
    );
  }
}
