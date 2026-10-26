import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config/env";
import { getSettings } from "../config/settings";
import { AppError } from "../errors";
import { redactSecrets } from "../observability/redact";
import { logger } from "../observability/logger";

export interface CommandAvailability {
  id: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
  available: boolean;
  unavailableReason: string | null;
  commandPreview: string;
}

interface CommandDefinition {
  id: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
  executable: string;
  args: string[];
  isAvailable: (context: ProjectContext) => boolean;
  unavailableReason: string;
}

interface ProjectContext {
  hasPackageJson: boolean;
  scripts: Record<string, string>;
  hasGoMod: boolean;
  hasCargoToml: boolean;
  hasPytestConfig: boolean;
  hasTestsDirectory: boolean;
}

function executableFor(name: string): string {
  return process.platform === "win32" && (name === "npm" || name === "npx") ? `${name}.cmd` : name;
}

const DEFINITIONS: CommandDefinition[] = [
  {
    id: "node.test",
    label: "Run npm test",
    description: "Runs the repository's `test` script. The script content is repository-controlled, so review it first.",
    risk: "medium",
    executable: executableFor("npm"),
    args: ["test", "--silent"],
    isAvailable: (context) => Boolean(context.scripts.test),
    unavailableReason: "package.json has no test script.",
  },
  {
    id: "node.lint",
    label: "Run npm run lint",
    description: "Runs the repository's `lint` script.",
    risk: "low",
    executable: executableFor("npm"),
    args: ["run", "lint", "--silent"],
    isAvailable: (context) => Boolean(context.scripts.lint),
    unavailableReason: "package.json has no lint script.",
  },
  {
    id: "node.typecheck",
    label: "Run npm run typecheck",
    description: "Runs the repository's `typecheck` script.",
    risk: "low",
    executable: executableFor("npm"),
    args: ["run", "typecheck", "--silent"],
    isAvailable: (context) => Boolean(context.scripts.typecheck),
    unavailableReason: "package.json has no typecheck script.",
  },
  {
    id: "node.build",
    label: "Run npm run build",
    description: "Runs the repository's `build` script. Build scripts can write files and fetch dependencies.",
    risk: "high",
    executable: executableFor("npm"),
    args: ["run", "build", "--silent"],
    isAvailable: (context) => Boolean(context.scripts.build),
    unavailableReason: "package.json has no build script.",
  },
  {
    id: "python.pytest",
    label: "Run python -m pytest",
    description: "Runs the repository's pytest suite. Repository test code executes with your user permissions.",
    risk: "medium",
    executable: process.platform === "win32" ? "python" : "python3",
    args: ["-m", "pytest", "-q"],
    isAvailable: (context) => context.hasPytestConfig || context.hasTestsDirectory,
    unavailableReason: "No pytest configuration or tests directory was detected.",
  },
  {
    id: "go.test",
    label: "Run go test ./...",
    description: "Runs the Go test suite for all packages.",
    risk: "medium",
    executable: "go",
    args: ["test", "./..."],
    isAvailable: (context) => context.hasGoMod,
    unavailableReason: "No go.mod found.",
  },
  {
    id: "cargo.test",
    label: "Run cargo test",
    description: "Runs the Cargo test suite.",
    risk: "medium",
    executable: "cargo",
    args: ["test"],
    isAvailable: (context) => context.hasCargoToml,
    unavailableReason: "No Cargo.toml found.",
  },
  {
    id: "cargo.check",
    label: "Run cargo check",
    description: "Type-checks the crate without producing binaries.",
    risk: "low",
    executable: "cargo",
    args: ["check"],
    isAvailable: (context) => context.hasCargoToml,
    unavailableReason: "No Cargo.toml found.",
  },
];

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function loadProjectContext(repositoryRoot: string): Promise<ProjectContext> {
  let scripts: Record<string, string> = {};
  let hasPackageJson = false;
  try {
    const raw = await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    scripts = parsed.scripts ?? {};
    hasPackageJson = true;
  } catch {
    hasPackageJson = false;
  }

  return {
    hasPackageJson,
    scripts,
    hasGoMod: await exists(path.join(repositoryRoot, "go.mod")),
    hasCargoToml: await exists(path.join(repositoryRoot, "Cargo.toml")),
    hasPytestConfig:
      (await exists(path.join(repositoryRoot, "pytest.ini"))) ||
      (await exists(path.join(repositoryRoot, "conftest.py"))) ||
      (await exists(path.join(repositoryRoot, "pyproject.toml"))),
    hasTestsDirectory:
      (await exists(path.join(repositoryRoot, "tests"))) ||
      (await exists(path.join(repositoryRoot, "test"))),
  };
}

export async function listCommands(repositoryRoot: string): Promise<CommandAvailability[]> {
  const context = await loadProjectContext(repositoryRoot);
  return DEFINITIONS.map((definition) => {
    const available = definition.isAvailable(context);
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      risk: definition.risk,
      available,
      unavailableReason: available ? null : definition.unavailableReason,
      commandPreview: [definition.executable.replace(/\.cmd$/, ""), ...definition.args].join(" "),
    };
  });
}

function executionEnv(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP",
    "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE", "OS",
  ];
  const env = {} as NodeJS.ProcessEnv;
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CI = "1";
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  return env;
}

export interface CommandResult {
  commandId: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  commandPreview: string;
}

export async function runCommand(
  repositoryRoot: string,
  commandId: string,
  options: { confirm: boolean },
): Promise<CommandResult> {
  const config = getConfig();
  const settings = getSettings();

  if (!config.allowCommands || !settings.commandExecution.enabled) {
    throw new AppError(
      "COMMAND_EXECUTION_DISABLED",
      "Command execution is disabled. Enable COMMITPILOT_ALLOW_COMMANDS and the Settings toggle to use it.",
    );
  }
  if (!options.confirm) {
    throw new AppError(
      "TOOL_FORBIDDEN",
      "Validation commands require explicit confirmation for each run.",
    );
  }

  const definition = DEFINITIONS.find((entry) => entry.id === commandId);
  if (!definition) {
    throw new AppError("COMMAND_NOT_ALLOWED", "That command is not in the allowlist.");
  }
  const context = await loadProjectContext(repositoryRoot);
  if (!definition.isAvailable(context)) {
    throw new AppError("COMMAND_NOT_ALLOWED", definition.unavailableReason);
  }

  const started = Date.now();
  const maxBytes = config.limits.maxCommandOutputBytes;

  return new Promise<CommandResult>((resolve, reject) => {
    execFile(
      definition.executable,
      definition.args,
      {
        cwd: repositoryRoot,
        timeout: config.limits.commandTimeoutMs,
        maxBuffer: maxBytes * 4,
        windowsHide: true,
        env: executionEnv(),
        encoding: "utf8",
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - started;
        if (error && !("killed" in error)) {
          logger.warn("command_failed_to_start", { commandId, durationMs });
          reject(
            new AppError(
              "COMMAND_NOT_ALLOWED",
              `The command could not be started: ${redactSecrets(error.message).slice(0, 200)}`,
            ),
          );
          return;
        }

        const timedOut = Boolean((error as NodeJS.ErrnoException & { killed?: boolean })?.killed);
        const exitCode =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? null)
            : error
              ? null
              : 0;

        const clean = (value: string): { text: string; truncated: boolean } => {
          const redacted = redactSecrets(value);
          if (Buffer.byteLength(redacted, "utf8") <= maxBytes) return { text: redacted, truncated: false };
          return { text: redacted.slice(0, maxBytes) + "\n[output truncated]", truncated: true };
        };
        const out = clean(stdout ?? "");
        const err = clean(stderr ?? "");

        logger.info("command_finished", {
          commandId,
          exitCode,
          timedOut,
          durationMs,
          stdoutBytes: Buffer.byteLength(stdout ?? "", "utf8"),
        });

        resolve({
          commandId,
          exitCode,
          timedOut,
          durationMs,
          stdout: out.text,
          stderr: err.text,
          truncated: out.truncated || err.truncated,
          commandPreview: [definition.executable.replace(/\.cmd$/, ""), ...definition.args].join(" "),
        });
      },
    );
  });
}
