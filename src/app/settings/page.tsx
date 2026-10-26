import { getConfig } from "@/server/config/env";
import {
  getModelKeyStatus,
  getSettings,
  getWorkspaceRoot,
} from "@/server/config/settings";
import { describeModelConfiguration } from "@/server/models/provider";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { Notice, PageHeader } from "@/components/ui";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const config = getConfig();
  const settings = getSettings();
  const model = describeModelConfiguration();
  const credential = getModelKeyStatus();

  let workspaceRoot: string | null = null;
  let workspaceError: string | null = null;
  try {
    workspaceRoot = await getWorkspaceRoot();
  } catch (error) {
    workspaceError = error instanceof AppError ? error.message : "The workspace root is invalid.";
  }

  const baseUrl = config.mcp.publicUrl ?? `http://${config.mcp.host}:${config.mcp.port}`;
  const url = `${baseUrl}/mcp`;
  const genericClientConfig = {
    mcpServers: {
      commitpilot: {
        type: "http",
        url,
        headers: { Authorization: "Bearer <COMMITPILOT_MCP_TOKEN>" },
      },
    },
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Server-side configuration for repository access, the open model, exclusions, execution limits, and the Alan MCP connector."
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {workspaceError ? (
          <Notice tone="danger" title="Workspace root invalid">
            {workspaceError}
          </Notice>
        ) : null}
        {!config.mcp.token ? (
          <Notice tone="warn" title="MCP connector disabled">
            <span className="font-mono">COMMITPILOT_MCP_TOKEN</span> is not set, so{" "}
            <span className="font-mono">npm run mcp</span> will refuse to start. Generate a token and add it
            to <span className="font-mono">.env</span>.
          </Notice>
        ) : null}

        <SettingsForm
          settings={{
            workspaceRoot: settings.workspaceRoot,
            model: settings.model,
            exclusions: settings.exclusions,
            privacy: settings.privacy,
            limits: settings.limits,
            commandExecution: settings.commandExecution,
          }}
          workspaceRoot={workspaceRoot}
          envWorkspaceRoot={config.workspaceRoot}
          model={model}
          credential={credential}
          flags={{ allowPatchApply: config.allowPatchApply, allowCommands: config.allowCommands }}
          mcp={{ url, tokenConfigured: Boolean(config.mcp.token) }}
          genericClientConfig={genericClientConfig}
        />
      </div>
    </div>
  );
}
