"use client";

import { useState } from "react";

interface CommandAvailability {
  id: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
  available: boolean;
  unavailableReason: string | null;
  commandPreview: string;
}

interface CommandResult {
  commandId: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  commandPreview: string;
}

export function ValidationCommands({
  repositoryId,
  commands,
  enabled,
}: {
  repositoryId: string;
  commands: CommandAvailability[];
  enabled: boolean;
}) {
  const [pending, setPending] = useState<CommandAvailability | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(command: CommandAvailability) {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/repositories/${repositoryId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: command.id, confirm: true }),
      });
      const payload = (await response.json()) as {
        result?: CommandResult;
        error?: { message: string };
      };
      if (!response.ok || !payload.result) {
        setError(payload.error?.message ?? "The command did not run.");
      } else {
        setResult(payload.result);
      }
    } catch {
      setError("The command request failed.");
    } finally {
      setRunning(false);
      setPending(null);
    }
  }

  return (
    <div className="space-y-3 px-4 py-4">
      {!enabled ? (
        <p className="rounded border border-line bg-raised/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
          Command execution is off. Enable it in Settings and set{" "}
          <span className="font-mono">COMMITPILOT_ALLOW_COMMANDS=true</span>. Repository scripts execute
          with your user permissions, so treat this as a trusted-local-repo feature.
        </p>
      ) : null}

      <ul className="space-y-2">
        {commands.map((command) => (
          <li key={command.id} className="rounded-md border border-line/70 bg-raised/40 px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">{command.label}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted">{command.commandPreview}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-[10px] uppercase ${
                    command.risk === "high" ? "text-danger" : command.risk === "medium" ? "text-warn" : "text-muted"
                  }`}
                >
                  {command.risk}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!enabled || !command.available || running}
                  onClick={() => setPending(command)}
                  title={command.available ? undefined : command.unavailableReason ?? "Unavailable"}
                >
                  Run
                </button>
              </div>
            </div>
            {!command.available ? (
              <p className="mt-1 text-[10px] text-muted">{command.unavailableReason}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {pending ? (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          <p>
            Run <span className="font-mono">{pending.commandPreview}</span> in this repository?
          </p>
          <p className="mt-1 text-warn/80">{pending.description}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={running}
              onClick={() => void run(pending)}
            >
              {running ? "Running…" : "Confirm and run"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="chip">exit {result.exitCode ?? "none"}</span>
            <span className="chip">{Math.round(result.durationMs / 1000)}s</span>
            {result.timedOut ? <span className="chip text-danger">timed out</span> : null}
            {result.truncated ? <span className="chip text-warn">output truncated</span> : null}
          </div>
          <pre className="code max-h-72 whitespace-pre-wrap" aria-live="polite">
            {result.stdout || "(no stdout)"}
            {result.stderr ? `\n\n[stderr]\n${result.stderr}` : ""}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
