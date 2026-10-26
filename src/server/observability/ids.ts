import { randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function correlationId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function shortId(id: string): string {
  const raw = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  return raw.slice(0, 8);
}
