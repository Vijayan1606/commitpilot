import { APP_VERSION } from "@/shared/constants";
import { getDb } from "@/server/db/client";
import { jsonOk } from "@/server/http/handler";
import { resolveModelConfig } from "@/server/config/settings";
import { activeJobCount } from "@/server/jobs/queue";
import { snapshot } from "@/server/observability/metrics";
import { createModelProvider } from "@/server/models/provider";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let database = "ok";
  try {
    getDb().prepare("SELECT 1 AS ok").get();
  } catch {
    database = "unavailable";
  }

  const model = resolveModelConfig();
  let modelHealth: { ok: boolean; detail: string } = {
    ok: false,
    detail: "Not checked.",
  };
  if (model.configured) {
    modelHealth = await createModelProvider(null).healthCheck();
  } else {
    modelHealth = {
      ok: false,
      detail: model.privacyBlocked
        ? "Remote model use is disabled in privacy settings."
        : "No open model configured.",
    };
  }

  const status = database === "ok" ? "ok" : "degraded";
  return jsonOk(
    {
      status,
      app: "commitpilot-ai",
      version: APP_VERSION,
      database,
      activeJobs: activeJobCount(),
      model: {
        configured: model.configured,
        provider: model.providerLabel,
        name: model.model,
        hosted: model.hosted,
        privacyBlocked: model.privacyBlocked,
        reachable: modelHealth.ok,
        detail: modelHealth.detail,
      },
      metrics: snapshot(),
      timestamp: new Date().toISOString(),
    },
    status === "ok" ? 200 : 503,
  );
}
