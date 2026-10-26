import Link from "next/link";
import { notFound } from "next/navigation";
import { SEVERITIES } from "@/shared/constants";
import { getConfig } from "@/server/config/env";
import { getSettings, getWorkspaceRoot } from "@/server/config/settings";
import {
  listJobsForRepository,
  listPatches,
  listReportsForRepository,
  severityCounts,
} from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { resolveRepositoryPath } from "@/server/fs/pathGuard";
import { getGitStatus } from "@/server/git/git";
import { inspectRepository } from "@/server/inspection/overview";
import { listCommands } from "@/server/commands/commands";
import { describeModelConfiguration } from "@/server/models/provider";
import { AppError } from "@/server/errors";
import { AnalysisLauncher } from "@/components/repository/AnalysisLauncher";
import { FileExplorer } from "@/components/repository/FileExplorer";
import { ValidationCommands } from "@/components/repository/ValidationCommands";
import { DeleteRepositoryButton } from "@/components/repository/DeleteRepositoryButton";
import {
  Card,
  CardHeader,
  Notice,
  PageHeader,
  SeverityBadge,
  SeverityBar,
  Stat,
  Tag,
  formatDate,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repository = getRepository(id);
  if (!repository) notFound();

  const settings = getSettings();
  const config = getConfig();
  const model = describeModelConfiguration();
  const jobs = listJobsForRepository(repository.id, 8);
  const patches = listPatches(repository.id, 5);
  const reports = listReportsForRepository(repository.id, 5);
  const counts = severityCounts(repository.id);
  const totalFindings = SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);

  let overviewAwaited: Awaited<ReturnType<typeof inspectRepository>> | null = null;
  let statusAwaited: Awaited<ReturnType<typeof getGitStatus>> | null = null;
  let commands: Awaited<ReturnType<typeof listCommands>> = [];
  let accessError: string | null = null;
  let accessCode: string | null = null;

  try {
    const workspaceRoot = await getWorkspaceRoot();
    const repositoryPath = await resolveRepositoryPath(workspaceRoot, repository.path);
    const [overviewResult, statusResult, commandResult] = await Promise.all([
      inspectRepository(repositoryPath, repository.name, {
        maxFiles: settings.limits.maxFiles,
        userExclusions: settings.exclusions,
      }),
      getGitStatus(repositoryPath),
      listCommands(repositoryPath),
    ]);
    overviewAwaited = overviewResult;
    statusAwaited = statusResult;
    commands = commandResult;
  } catch (error) {
    accessError =
      error instanceof AppError ? error.message : "The repository could not be read from disk.";
    accessCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Repository"
        title={repository.name}
        description={repository.path}
        actions={
          <>
            <Link className="btn btn-sm" href={`/reports?repositoryId=${repository.id}`}>
              Reports
            </Link>
            <DeleteRepositoryButton repositoryId={repository.id} name={repository.name} />
          </>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {accessError ? (
          <Notice tone="danger" title="Repository unavailable">
            {accessError} The registration is kept; re-check the path or update the workspace root.
            <span className="ml-2 font-mono text-[10px] text-muted">{accessCode}</span>
          </Notice>
        ) : null}

        {!model.configured ? (
          <Notice tone={model.privacyBlocked ? "danger" : "warn"} title="Model-dependent actions are blocked">
            {model.privacyBlocked
              ? "Remote model use is disabled in privacy settings."
              : "No open model is configured yet."}{" "}
            <Link className="link" href="/settings">
              Configure the model
            </Link>
            . Test-gap and security scans still run deterministically.
          </Notice>
        ) : null}

        {overviewAwaited && statusAwaited ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Branch"
                value={overviewAwaited.branch ?? "detached"}
                hint={overviewAwaited.headCommit?.slice(0, 10) ?? "no commits yet"}
              />
              <Stat
                label="Working tree"
                value={statusAwaited.isDirty ? "dirty" : "clean"}
                tone={statusAwaited.isDirty ? "warn" : "ok"}
                hint={`${statusAwaited.staged.length} staged · ${statusAwaited.untracked.length} untracked`}
              />
              <Stat
                label="Tracked files"
                value={overviewAwaited.fileCount}
                hint={`${overviewAwaited.sourceFileCount} source · ${overviewAwaited.testFileCount} tests`}
              />
              <Stat
                label="Findings"
                value={totalFindings}
                tone={counts.critical > 0 ? "danger" : counts.high > 0 ? "warn" : "default"}
                hint={`${counts.critical} critical · ${counts.high} high`}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <AnalysisLauncher
                  repositoryId={repository.id}
                  modelConfigured={model.configured}
                  hasChanges={statusAwaited.isDirty}
                />

                <Card className="overflow-hidden">
                  <CardHeader
                    title="Tracked files"
                    description="Filter and inspect files. Excluded paths are not listed."
                  />
                  <FileExplorer repositoryId={repository.id} />
                </Card>

                <Card>
                  <CardHeader title="Recent commits" />
                  {overviewAwaited.commits.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted">No commits in this repository yet.</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line/70 text-[11px] uppercase tracking-wider text-muted">
                          <th className="px-4 py-2 font-medium">Commit</th>
                          <th className="px-4 py-2 font-medium">Subject</th>
                          <th className="px-4 py-2 font-medium">Author</th>
                          <th className="px-4 py-2 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overviewAwaited.commits.map((commit) => (
                          <tr key={commit.shortHash} className="table-row">
                            <td className="px-4 py-2 font-mono text-[11px] text-citron">{commit.shortHash}</td>
                            <td className="max-w-[320px] truncate px-4 py-2 text-xs">{commit.subject}</td>
                            <td className="px-4 py-2 text-xs text-muted">{commit.author}</td>
                            <td className="px-4 py-2 text-[11px] text-muted">{formatDate(commit.date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>

                <Card>
                  <CardHeader
                    title="Analysis history"
                    actions={
                      <Link className="btn btn-sm" href={`/reports?repositoryId=${repository.id}`}>
                        Reports
                      </Link>
                    }
                  />
                  {jobs.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted">No analyses yet for this repository.</p>
                  ) : (
                    <ul className="divide-y divide-line/60">
                      {jobs.map((job) => (
                        <li key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <Link className="link truncate text-sm" href={`/analysis/${job.id}`}>
                              {job.analysisType.replace(/_/g, " ")}
                            </Link>
                            <p className="mt-0.5 truncate text-[11px] text-muted">
                              {job.summary ?? job.stage ?? "queued"} · {formatDate(job.createdAt)}
                            </p>
                          </div>
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
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader title="Git status" description="Tracked changes only." />
                  <div className="space-y-3 px-4 py-4 text-xs">
                    {[
                      { label: "Staged", items: statusAwaited.staged },
                      { label: "Modified", items: statusAwaited.modified },
                      { label: "Deleted", items: statusAwaited.deleted },
                      { label: "Renamed", items: statusAwaited.renamed },
                      { label: "Untracked", items: statusAwaited.untracked },
                    ].map((group) => (
                      <div key={group.label}>
                        <p className="label">
                          {group.label} · {group.items.length}
                        </p>
                        {group.items.length > 0 ? (
                          <ul className="mt-1 space-y-0.5">
                            {group.items.slice(0, 6).map((item) => (
                              <li key={item} className="truncate font-mono text-[11px] text-muted">
                                {item}
                              </li>
                            ))}
                            {group.items.length > 6 ? (
                              <li className="text-[10px] text-muted/70">+{group.items.length - 6} more</li>
                            ) : null}
                          </ul>
                        ) : (
                          <p className="mt-1 text-[11px] text-muted/60">none</p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Language mix" description="Tracked text files by extension." />
                  <div className="space-y-2.5 px-4 py-4">
                    {overviewAwaited.languages.length === 0 ? (
                      <p className="text-xs text-muted">No recognised source files.</p>
                    ) : (
                      overviewAwaited.languages.map((language) => (
                        <div key={language.language}>
                          <div className="flex items-center justify-between text-[11px]">
                            <span>{language.language}</span>
                            <span className="font-mono text-muted">
                              {language.files} · {language.percent}%
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 w-full rounded-full bg-raised">
                            <div
                              className="h-1.5 rounded-full bg-citron/70"
                              style={{ width: `${Math.max(language.percent, 2)}%` }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                <Card>
                  <CardHeader title="Stack signals" description="Detected, not guessed." />
                  <dl className="space-y-3 px-4 py-4 text-xs">
                    <div>
                      <dt className="label">Frameworks</dt>
                      <dd className="mt-1 flex flex-wrap gap-1.5">
                        {overviewAwaited.frameworks.length > 0 ? (
                          overviewAwaited.frameworks.map((framework) => (
                            <span key={framework} className="chip">
                              {framework}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted">none detected</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="label">Package manager</dt>
                      <dd className="mt-1 font-mono text-[11px]">{overviewAwaited.packageManager ?? "unknown"}</dd>
                    </div>
                    <div>
                      <dt className="label">Manifests</dt>
                      <dd className="mt-1 space-y-0.5">
                        {overviewAwaited.manifests.length > 0 ? (
                          overviewAwaited.manifests.map((manifest) => (
                            <p key={manifest} className="truncate font-mono text-[11px] text-muted">
                              {manifest}
                            </p>
                          ))
                        ) : (
                          <span className="text-muted">none</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </Card>

                <Card>
                  <CardHeader title="Findings by severity" />
                  <div className="space-y-3 px-4 py-4">
                    <SeverityBar counts={counts} total={totalFindings} />
                    <div className="grid grid-cols-5 gap-1.5">
                      {SEVERITIES.map((severity) => (
                        <div key={severity} className="rounded border border-line/60 px-1 py-1.5 text-center">
                          <SeverityBadge severity={severity} />
                          <p className="mt-1 font-mono text-sm">{counts[severity]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    title="Validation commands"
                    description="Allowlisted only. Every run is explicit."
                  />
                  <ValidationCommands
                    repositoryId={repository.id}
                    commands={commands}
                    enabled={settings.commandExecution.enabled && config.allowCommands}
                  />
                </Card>

                <Card>
                  <CardHeader title="Patches & reports" />
                  <div className="space-y-2 px-4 py-4 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Patch proposals</span>
                      <span className="font-mono">{patches.length}</span>
                    </div>
                    {patches.slice(0, 3).map((patch) => (
                      <Link
                        key={patch.id}
                        href={`/patches/${patch.id}`}
                        className="block truncate rounded border border-line/60 px-2 py-1.5 text-[11px] hover:border-citron/40"
                      >
                        {patch.title}
                      </Link>
                    ))}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-muted">Saved reports</span>
                      <span className="font-mono">{reports.length}</span>
                    </div>
                    {reports.slice(0, 3).map((report) => (
                      <Link
                        key={report.id}
                        href={`/reports/${report.id}`}
                        className="block truncate rounded border border-line/60 px-2 py-1.5 text-[11px] hover:border-citron/40"
                      >
                        {report.title}
                      </Link>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}