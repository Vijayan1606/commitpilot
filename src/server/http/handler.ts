import { NextResponse } from "next/server";
import { AppError, toAppError } from "../errors";
import { logger } from "../observability/logger";

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function jsonError(error: unknown): NextResponse {
  const appError = toAppError(error);
  if (appError.code === "INTERNAL_ERROR") {
    logger.error("api_internal_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }
  return NextResponse.json(appError.toStructured(), {
    status: appError.httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Reject cross-site browser requests. The API is same-origin and has no cookie
 * auth, so an external page must not be able to drive repository operations
 * through a victim's browser (including DNS-rebinding style requests).
 */
function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    let requestUrl: URL;
    try {
      originUrl = new URL(origin);
      requestUrl = new URL(request.url);
    } catch {
      throw new AppError("UNAUTHORIZED", "The request origin is invalid.");
    }
    // Browsers may spell loopback as localhost or 127.0.0.1 while Next reports
    // the request host in a different but equivalent form.
    const equivalentLoopback =
      isLoopbackHostname(originUrl.hostname) &&
      isLoopbackHostname(requestUrl.hostname) &&
      originUrl.port === requestUrl.port;
    if (originUrl.host !== requestUrl.host && !equivalentLoopback) {
      throw new AppError("UNAUTHORIZED", "Cross-origin requests are not allowed.");
    }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError("UNAUTHORIZED", "Cross-site requests are not allowed.");
  }
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  assertSameOrigin(request);
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new AppError("INVALID_ARGUMENTS", "The request body could not be read.");
  }
  if (text.length > 200_000) {
    throw new AppError("INVALID_ARGUMENTS", "The request body is too large.");
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_ARGUMENTS", "The request body must be valid JSON.");
  }
}

export function requireId(value: string | undefined, label: string): string {
  if (!value || value.length < 3 || value.length > 200) {
    throw new AppError("INVALID_ARGUMENTS", `A valid ${label} is required.`);
  }
  return value;
}
