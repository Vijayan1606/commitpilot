import Link from "next/link";
import { SEVERITIES } from "@/shared/constants";
import { countJobs, countReports, listJobs, severityCounts } from "@/server/db/analysis";
import { listOperations, listRepositories } from "@/server/db/repositories";
import { describeModelConfiguration } from "@/server/models/provider";
import {
  Card,
  CardHeader,
  EmptyState,
  Notice,
  PageHeader,
  SeverityBadge,
  SeverityBar,
  Stat,
  Tag,
  formatDate,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const repositories = listRepositories();
  const jobs = listJobs(8);
  const counts = severityCounts();
  const totalFindings = SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
  const totalJobs = countJobs();
  const totalReports = countReports();
  const operations = listOperations(8);
  const model = describeModelConfiguration();
  const repoName = new Map(repositories.map((repository) => [repository.id, repository.name]));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Control room"
        title="Your repository, under review"
        description="Register a local Git repository, then ask Alan to analyse it, review your diff, or propose a patch. Every finding carries evidence and a verification status."
        actions={
          <>
            <Link className="btn btn-primary" href="/repositories">
              Register a repository
            </Link>
            <Link className="btn" href="/settings">
              Configure model
            </Link>
          </>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {!model.configured ? (
          <Notice tone={model.privacyBlocked ? "danger" : "warn"} title="Open model not ready">
            {model.privacyBlocked
              ? "A remote model endpoint is configured but remote use is disabled in privacy settings. Enable it in Settings or point the base URL at a loopback endpoint."
              : "Analysis and review need an open-weights model behind an OpenAI-compatible endpoint. Configure it in Settings, then run an analysis."}{" "}
            <Link className="link" href="/settings">
              Open settings
            </Link>
          </Notice>
        ) : null}

        {repositories.length === 0 ? (
          <div className="space-y-6">
            <EmptyState
              title="No repositories registered yet"
              description="CommitPilot only reads repositories inside the configured workspace root. Create a Git repository there, then register its path. The dashboard will populate with real analyses — never sample data."
              action={
                <Link className="btn btn-primary" href="/repositories">
                  Register your first repository
                </Link>
              }
            />
            <Card>
              <CardHeader
                title="Three steps to a real analysis"
                description="No fixtures, no fake metrics."
              />
              <ol className="divide-y divide-line/60">
                {[
                  {
                    step: "01",
                    title: "Point the workspace at a folder you own",
                    body: "Set COMMITPILOT_WORKSPACE_ROOT (default ./.workspaces) or change it in Settings. Paths are resolved with symlinks and containment checks.",
                  },
                  {
                    step: "02",
                    title: "Register a Git repository",
                    body: "The path must be inside the workspace root and contain a .git entry. Registration never browses your filesystem.",
                  },
                  {
                    step: "03",
                    title: "Ask Alan to analyse or review",
                    body: "Connect the MCP server in Alan, then ask a question. The tools return real file evidence and the model only sees bounded, redacted context.",
                  },
                ].map((item) => (
                  <li key={item.step} className="flex gap-4 px-4 py-4">
                    <span className="font-mono text-xs text-citron">{item.step}</span>
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Repositories" value={repositories.length} hint="Inside the workspace root" />
              <Stat label="Analyses" value={totalJobs} hint="All persisted jobs" />
              <Stat
                label="Open findings"
                value={totalFindings}
                hint={`${counts.critical} critical · ${counts.high} high`}
                tone={counts.critical > 0 ? "danger" : counts.high > 0 ? "warn" : "default"}
              />
              <Stat label="Saved reports" value={totalReports} hint="Markdown and JSON export" />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <Card>
                  <CardHeader
                    title="Recent analyses"
                    description="Every run is persisted with its model and correlation id."
                    actions={
                      <Link className="btn btn-sm" href="/repositories">
                        All repositories
                      </Link>
                    }
                  />
                  {jobs.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted">
                      No analyses yet. Open a repository and run one.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-line/70 text-[11px] uppercase tracking-wider text-muted">
                            <th className="px-4 py-2 font-medium">Repository</th>
                            <th className="px-4 py-2 font-medium">Type</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium">Model</th>
                            <th className="px-4 py-2 font-medium">Started</th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobs.map((job) => (
                            <tr key={job.id} className="table-row">
                              <td className="px-4 py-3">
                                <Link className="link" href={`/analysis/${job.id}`}>
                                  {repoName.get(job.repositoryId) ?? "removed repository"}
                                </Link>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted">{job.analysisType}</td>
                              <td className="px-4 py-3">
                                <Tag
                                  tone={
                                    job.status === "completed"
                                      ? "ok"
                                      : job.status === "failed"
                                        ? "danger"
                                        : job.status === "cancelled"
                                          ? "warn"
                                          : "info"
                                  }
                                >
                                  {job.status}
                                </Tag>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted">
                                {job.modelName ?? "—"}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted">{formatDate(job.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Findings by severity" description="All persisted findings across repositories." />
                  <div className="space-y-4 px-4 py-4">
                    <SeverityBar counts={counts} total={totalFindings} />
                    <div className="grid grid-cols-5 gap-2">
                      {SEVERITIES.map((severity) => (
                        <div key={severity} className="rounded border border-line/70 bg-raised/40 px-2 py-2 text-center">
                          <SeverityBadge severity={severity} />
                          <p className="mt-1.5 font-mono text-lg">{counts[severity]}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted">
                      A finding is not a confirmed vulnerability. Static rule matches and AI hypotheses are
                      labelled separately, and only executed tests can raise verification.
                    </p>
                  </div>
                </Card>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader title="Quick actions" />
                  <div className="space-y-2 px-4 py-4">
                    {repositories.slice(0, 4).map((repository) => (
                      <Link
                        key={repository.id}
                        href={`/repositories/${repository.id}`}
                        className="flex items-center justify-between rounded-md border border-line/70 bg-raised/40 px-3 py-2 text-sm hover:border-citron/40"
                      >
                        <span className="truncate">{repository.name}</span>
                        <span className="font-mono text-[11px] text-muted">open →</span>
                      </Link>
                    ))}
                    <Link className="btn w-full" href="/patches">
                      Review proposed patches
                    </Link>
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Recent operations" description="Tool and job history, redacted." />
                  {operations.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted">Nothing recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-line/60">
                      {operations.map((operation) => (
                        <li key={operation.id} className="px-4 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate font-mono text-xs">{operation.operationType}</span>
                            <Tag
                              tone={
                                operation.outcome === "success"
                                  ? "ok"
                                  : operation.outcome === "rejected"
                                    ? "warn"
                                    : "danger"
                              }
                            >
                              {operation.outcome}
                            </Tag>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted">{formatDate(operation.createdAt)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
