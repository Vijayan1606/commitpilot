"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface SettingsFormProps {
  settings: {
    workspaceRoot: string | null;
    model: { baseUrl: string | null; model: string | null };
    exclusions: string[];
    privacy: { allowHostedModel: boolean };
    limits: { maxFiles: number; maxContextChars: number };
    commandExecution: { enabled: boolean };
  };
  workspaceRoot: string | null;
  envWorkspaceRoot: string;
  model: {
    provider: string;
    model: string | null;
    baseUrlHost: string | null;
    configured: boolean;
    hosted: boolean;
    privacyBlocked: boolean;
  };
  credential: { configured: boolean; source: string; last4: string | null };
  flags: { allowPatchApply: boolean; allowCommands: boolean };
  mcp: { url: string; tokenConfigured: boolean };
  genericClientConfig: unknown;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="border-b border-line/60 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </section>
  );
}

export function SettingsForm(props: SettingsFormProps) {
  const router = useRouter();
  const [workspaceRoot, setWorkspaceRoot] = useState(props.settings.workspaceRoot ?? "");
  const [baseUrl, setBaseUrl] = useState(props.settings.model.baseUrl ?? "");
  const [modelName, setModelName] = useState(props.settings.model.model ?? "");
  const [exclusions, setExclusions] = useState(props.settings.exclusions.join("\n"));
  const [allowHostedModel, setAllowHostedModel] = useState(props.settings.privacy.allowHostedModel);
  const [maxFiles, setMaxFiles] = useState(props.settings.limits.maxFiles);
  const [maxContextChars, setMaxContextChars] = useState(props.settings.limits.maxContextChars);
  const [commandEnabled, setCommandEnabled] = useState(props.settings.commandExecution.enabled);

  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; detail: string } | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceRoot: workspaceRoot.trim() ? workspaceRoot.trim() : null,
          model: {
            baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
            model: modelName.trim() ? modelName.trim() : null,
          },
          exclusions: exclusions
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          privacy: { allowHostedModel },
          limits: { maxFiles: Number(maxFiles), maxContextChars: Number(maxContextChars) },
          commandExecution: { enabled: commandEnabled },
        }),
      });
      const payload = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setError(payload.error?.message ?? "The settings could not be saved.");
        return;
      }
      setMessage("Settings saved.");
      router.refresh();
    } catch {
      setError("The request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveKey() {
    setKeyMessage(null);
    setKeyError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setKeyError(payload.error?.message ?? "The key could not be saved.");
        return;
      }
      setApiKey("");
      setKeyMessage("Credential stored server-side (encrypted at rest).");
      router.refresh();
    } catch {
      setKeyError("The request failed.");
    }
  }

  async function clearKey() {
    setKeyMessage(null);
    setKeyError(null);
    try {
      const response = await fetch("/api/settings", { method: "DELETE" });
      if (!response.ok) {
        setKeyError("The stored key could not be removed.");
        return;
      }
      setKeyMessage("Stored credential removed.");
      router.refresh();
    } catch {
      setKeyError("The request failed.");
    }
  }

  async function checkHealth() {
    setHealthBusy(true);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = (await response.json()) as { model?: { reachable: boolean; detail: string } };
      setHealth({
        ok: Boolean(payload.model?.reachable),
        detail: payload.model?.detail ?? "No model status returned.",
      });
    } catch {
      setHealth({ ok: false, detail: "The health check failed." });
    } finally {
      setHealthBusy(false);
    }
  }

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(props.genericClientConfig, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Section
        title="Workspace root"
        description="Every repository and file operation is contained inside this directory. Symlinks are resolved before the check."
      >
        <div className="space-y-1.5">
          <label htmlFor="workspace-root" className="block text-xs font-medium">
            Absolute path
          </label>
          <input
            id="workspace-root"
            className="input font-mono text-xs"
            value={workspaceRoot}
            placeholder={props.envWorkspaceRoot}
            onChange={(event) => setWorkspaceRoot(event.target.value)}
          />
          <p className="text-[11px] leading-relaxed text-muted">
            Empty uses the environment default <span className="font-mono">{props.envWorkspaceRoot}</span>.
            Current resolved root: <span className="font-mono">{props.workspaceRoot ?? "unavailable"}</span>.
            Changing it is rejected if a registered repository would fall outside.
          </p>
        </div>
      </Section>

      <Section
        title="Open model"
        description="Any OpenAI-compatible chat-completions endpoint serving open weights. No GPU is required for a small local model."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="base-url" className="block text-xs font-medium">
              Base URL
            </label>
            <input
              id="base-url"
              className="input font-mono text-xs"
              placeholder="http://127.0.0.1:11434/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="model-name" className="block text-xs font-medium">
              Model name
            </label>
            <input
              id="model-name"
              className="input font-mono text-xs"
              placeholder="qwen2.5-coder:7b-instruct"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded border border-line bg-raised/40 px-3 py-2 text-[11px]">
          <span className={props.model.configured ? "text-ok" : "text-warn"}>
            {props.model.configured ? "configured" : "not configured"}
          </span>
          <span className="text-muted">·</span>
          <span className="text-muted">
            {props.model.hosted ? "hosted endpoint" : "loopback endpoint"}
          </span>
          {props.model.privacyBlocked ? (
            <>
              <span className="text-muted">·</span>
              <span className="text-danger">blocked by privacy setting</span>
            </>
          ) : null}
          <button type="button" className="btn btn-sm ml-auto" onClick={() => void checkHealth()} disabled={healthBusy}>
            {healthBusy ? "Checking…" : "Check provider"}
          </button>
        </div>
        {health ? (
          <p className={`text-[11px] ${health.ok ? "text-ok" : "text-warn"}`}>{health.detail}</p>
        ) : null}

        <div className="space-y-2 rounded border border-line bg-canvas/40 px-3 py-3">
          <p className="text-xs font-medium">API credential</p>
          <p className="text-[11px] leading-relaxed text-muted">
            Stored encrypted on the server, never returned to the browser.{" "}
            {props.credential.configured
              ? `Currently configured (${props.credential.source}, ending ${props.credential.last4 ?? "••••"}).`
              : "No credential configured. Local endpoints such as Ollama usually need none."}
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-xs font-mono text-xs"
              type="password"
              placeholder="Paste a new key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              aria-label="New model API key"
            />
            <button type="button" className="btn" disabled={apiKey.trim().length < 8} onClick={() => void saveKey()}>
              Save key
            </button>
            {props.credential.source === "settings" ? (
              <button type="button" className="btn btn-ghost" onClick={() => void clearKey()}>
                Remove
              </button>
            ) : null}
          </div>
          {keyMessage ? <p className="text-[11px] text-ok">{keyMessage}</p> : null}
          {keyError ? <p className="text-[11px] text-danger">{keyError}</p> : null}
        </div>

        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5 accent-citron"
            checked={allowHostedModel}
            onChange={(event) => setAllowHostedModel(event.target.checked)}
          />
          <span>
            Allow sending repository excerpts to a remote (non-loopback) model endpoint.
            <span className="mt-0.5 block text-[11px] text-muted">
              When off, analysis is refused for hosted endpoints instead of silently sending code.
            </span>
          </span>
        </label>
      </Section>

      <Section
        title="Exclusions and limits"
        description="Mandatory secret and dependency exclusions always apply. These are additional paths or globs."
      >
        <div className="space-y-1.5">
          <label htmlFor="exclusions" className="block text-xs font-medium">
            Additional exclusions
          </label>
          <textarea
            id="exclusions"
            className="input min-h-[90px] resize-y font-mono text-xs"
            placeholder={"docs/internal\n*.snap\nfixtures/"}
            value={exclusions}
            onChange={(event) => setExclusions(event.target.value)}
          />
          <p className="text-[11px] text-muted">One path or glob per line. Maximum 100 entries.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="max-files" className="block text-xs font-medium">
              Maximum tracked files per scan
            </label>
            <input
              id="max-files"
              type="number"
              min={10}
              max={20000}
              className="input font-mono text-xs"
              value={maxFiles}
              onChange={(event) => setMaxFiles(Number(event.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="max-context" className="block text-xs font-medium">
              Model context budget (characters)
            </label>
            <input
              id="max-context"
              type="number"
              min={4000}
              max={1000000}
              step={1000}
              className="input font-mono text-xs"
              value={maxContextChars}
              onChange={(event) => setMaxContextChars(Number(event.target.value))}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Command execution"
        description="Allowlisted validation commands only. Repository scripts run with your user permissions."
      >
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            className="mt-0.5 accent-citron"
            checked={commandEnabled}
            onChange={(event) => setCommandEnabled(event.target.checked)}
          />
          <span>
            Enable validation commands in the UI.
            <span className="mt-0.5 block text-[11px] text-muted">
              Also requires <span className="font-mono">COMMITPILOT_ALLOW_COMMANDS=true</span> on the server
              (currently {props.flags.allowCommands ? "set" : "not set"}) and a confirmation for every run.
            </span>
          </span>
        </label>
        <p className="text-[11px] leading-relaxed text-muted">
          Patch application is controlled separately by{" "}
          <span className="font-mono">COMMITPILOT_ALLOW_PATCH_APPLY</span> (currently{" "}
          {props.flags.allowPatchApply ? "enabled" : "disabled"}).
        </p>
      </Section>

      {message ? <p className="text-xs text-ok">{message}</p> : null}
      {error ? (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>

      <Section
        title="Alan AI connector"
        description="Alan connects to CommitPilot through an MCP custom connector. The token stays on the server."
      >
        <div className="space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-ink">{props.mcp.url}</span>
            <span className={props.mcp.tokenConfigured ? "text-ok" : "text-danger"}>
              {props.mcp.tokenConfigured ? "bearer token configured" : "bearer token missing"}
            </span>
          </div>
          <p className="leading-relaxed text-muted">
            In Alan: <span className="text-ink">Settings → Plugins → MCP → Add custom connector</span>, paste
            the URL, and add an <span className="font-mono">Authorization: Bearer &lt;token&gt;</span> header.
            Generic MCP client configuration:
          </p>
          <pre className="code max-h-52 whitespace-pre-wrap">{JSON.stringify(props.genericClientConfig, null, 2)}</pre>
          <button type="button" className="btn btn-sm" onClick={() => void copyConfig()}>
            {copied ? "Copied" : "Copy configuration"}
          </button>
          <p className="leading-relaxed text-muted">
            The MCP process is separate from this web app. Start it with{" "}
            <span className="font-mono">npm run mcp</span>. It binds to{" "}
            <span className="font-mono">127.0.0.1</span> by default; expose it only through an authenticated
            tunnel.
          </p>
        </div>
      </Section>
    </form>
  );
}
