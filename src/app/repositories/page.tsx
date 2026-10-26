import Link from "next/link";
import { getSettings, getWorkspaceRoot } from "@/server/config/settings";
import { listRepositories } from "@/server/db/repositories";
import { RegisterRepositoryForm } from "@/components/repository/RegisterRepositoryForm";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Tag, formatDate } from "@/components/ui";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

export default async function RepositoriesPage() {
  const repositories = listRepositories();
  let workspaceRoot: string | null = null;
  let workspaceError: string | null = null;
  try {
    workspaceRoot = await getWorkspaceRoot();
  } catch (error) {
    workspaceError = error instanceof AppError ? error.message : "The workspace root is invalid.";
  }
  const settings = getSettings();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Registry"
        title="Repositories"
        description="Register a repository by path. CommitPilot validates containment, resolves symlinks, and only reads tracked files that pass the exclusion rules."
      />

      <div className="grid gap-6 px-5 py-6 sm:px-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {workspaceError ? (
            <Notice tone="danger" title="Workspace root unavailable">
              {workspaceError} Update <span className="font-mono">COMMITPILOT_WORKSPACE_ROOT</span> or the
              setting on the <Link className="link" href="/settings">settings page</Link>.
            </Notice>
          ) : null}

          {repositories.length === 0 ? (
            <EmptyState
              title="Nothing registered"
              description="Create or clone a Git repository inside your workspace root, then register its absolute path using the form."
            />
          ) : (
            <div className="space-y-3">
              {repositories.map((repository) => (
                <Card key={repository.id} className="transition-colors hover:border-citron/30">
                  <Link href={`/repositories/${repository.id}`} className="block px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="truncate text-sm font-semibold">{repository.name}</h2>
                          <Tag tone="neutral">local</Tag>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted">{repository.path}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-muted">
                          checked {formatDate(repository.lastCheckedAt)}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-citron">open →</p>
                      </div>
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Register a repository"
              description="The path is validated on every operation, not just at registration."
            />
            <RegisterRepositoryForm workspaceRoot={workspaceRoot} />
          </Card>

          <Card>
            <CardHeader title="What is read" />
            <ul className="space-y-2 px-4 py-4 text-xs leading-relaxed text-muted">
              <li>
                <span className="text-ink">Tracked files only.</span> Untracked files are counted in git
                status but never included in model context.
              </li>
              <li>
                <span className="text-ink">Mandatory exclusions.</span> .env files, keys, credential
                files, dependency and build directories are always skipped.
              </li>
              <li>
                <span className="text-ink">Additional exclusions.</span>{" "}
                {settings.exclusions.length > 0
                  ? `${settings.exclusions.length} configured on the settings page.`
                  : "None configured yet."}
              </li>
              <li>
                <span className="text-ink">No writes without approval.</span> Analysis and review are
                read-only. Patches are proposals until you approve them.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
