export type ErrorCode =
  | "INVALID_ARGUMENTS"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_INVALID"
  | "REPOSITORY_DUPLICATE"
  | "PATH_OUTSIDE_WORKSPACE"
  | "PATH_REJECTED"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "FILE_EXCLUDED"
  | "TOOL_NOT_FOUND"
  | "TOOL_FORBIDDEN"
  | "TOOL_TIMEOUT"
  | "TOOL_OUTPUT_TOO_LARGE"
  | "MODEL_NOT_CONFIGURED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_TIMEOUT"
  | "MODEL_RATE_LIMITED"
  | "MODEL_INVALID_RESPONSE"
  | "JOB_NOT_FOUND"
  | "JOB_CONFLICT"
  | "PATCH_INVALID"
  | "PATCH_APPLY_DISABLED"
  | "PATCH_REJECTED"
  | "COMMAND_NOT_ALLOWED"
  | "COMMAND_EXECUTION_DISABLED"
  | "REPORT_NOT_FOUND"
  | "CONFIG_INVALID"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { httpStatus?: number; details?: unknown; expose?: boolean } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? defaultStatus(code);
    this.details = options.details;
    this.expose = options.expose ?? true;
  }

  toStructured(): { error: { code: ErrorCode; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.expose ? this.message : "An internal error occurred.",
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "INVALID_ARGUMENTS":
    case "CONFIG_INVALID":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "TOOL_FORBIDDEN":
    case "PATCH_APPLY_DISABLED":
    case "COMMAND_EXECUTION_DISABLED":
      return 403;
    case "NOT_FOUND":
    case "REPOSITORY_NOT_FOUND":
    case "FILE_NOT_FOUND":
    case "TOOL_NOT_FOUND":
    case "JOB_NOT_FOUND":
    case "REPORT_NOT_FOUND":
      return 404;
    case "REPOSITORY_DUPLICATE":
    case "JOB_CONFLICT":
    case "PATCH_INVALID":
      return 409;
    case "FILE_TOO_LARGE":
    case "TOOL_OUTPUT_TOO_LARGE":
      return 413;
    case "TOOL_TIMEOUT":
    case "MODEL_TIMEOUT":
      return 504;
    case "MODEL_UNAVAILABLE":
    case "MODEL_RATE_LIMITED":
      return 503;
    case "MODEL_NOT_CONFIGURED":
      return 412;
    default:
      return 500;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new AppError("TOOL_TIMEOUT", "The operation was cancelled or timed out.");
  }
  return new AppError("INTERNAL_ERROR", "An internal error occurred.", { expose: false });
}
