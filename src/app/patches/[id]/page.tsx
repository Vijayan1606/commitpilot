import Link from "next/link";
import { notFound } from "next/navigation";
import { getPatch } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { getConfig } from "@/server/config/env";
import { PatchDecision } from "@/components/patches/PatchDecision";
import { Card, CardHeader, Notice, PageHeader, Tag, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n").slice(0, 2000);
  return (
    <pre className="max-h-[560px] overflow-auto rounded-b-lg bg-canvas/80 p-0 font-mono text-[11.5px] leading-[1.6]">
      <code>
        {lines.map((line, index) => {
          const tone = line.startsWith("+++") || line.startsWith("---")
            ? "text-muted"
            : line.startsWith("+")
              ? "text-ok bg-ok/5"
              : line.startsWith("-")
                ? "text-danger bg-danger/5"
                : line.startsWith("@@")
                  ? "text-citron bg-citron/5"
                  : line.startsWith("diff --git") || line.startsWith("index ")
                    ? "text-muted"
                    : "text-ink/80";
          return (
            <span key={index} className={`block whitespace-pre px-3 ${tone}`}>
              {line || " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export default async function PatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patch = getPatch(id);
  if (!patch) notFound();
  const repository = getRepository(patch.repositoryId);
  const config = getConfig();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={repository?.name ?? "Removed repository"}
        title={patch.title}
        description={patch.rationale}
        actions={
          <>
            <Tag
              tone={
                patch.status === "applied"
                  ? "ok"
                  : patch.status === "invalid"
                    ? "danger"
                    : patch.status === "rejected"
                      ? "warn"
                      : "info"
              }
            >
              {patch.status}
            </Tag>
            {repository ? (
              <Link className="btn btn-sm" href={`/repositories/${repository.id}`}>
                Repository
              </Link>
            ) : null}
          </>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {!patch.validation.ok ? (
          <Notice tone="danger" title="Validation failed">
            <ul className="list-inside list-disc space-y-1">
              {patch.validation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              The proposal is stored for inspection but cannot be applied. Nothing was written.
            </p>
          </Notice>
        ) : (
          <Notice tone="ok" title="Validated">
            <span className="font-mono">git apply --check</span> passed. The diff touches{" "}
            {patch.validation.filesTouched.length} tracked file(s).
            {patch.validation.diffStat ? (
              <pre className="mt-2 overflow-auto rounded bg-canvas/60 px-2 py-1 font-mono text-[10px]">
                {patch.validation.diffStat}
              </pre>
            ) : null}
          </Notice>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader
              title="Proposed diff"
              description={`${patch.files.length} file(s) · created ${formatDate(patch.createdAt)}`}
            />
            <DiffView diff={patch.patchText} />
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Decision" description="Approval is explicit and auditable." />
              <PatchDecision patchId={patch.id} status={patch.status} applyEnabled={config.allowPatchApply} />
            </Card>

            <Card>
              <CardHeader title="Validation detail" />
              <dl className="space-y-2 px-4 py-4 text-[11px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Checked</dt>
                  <dd className="font-mono">{formatDate(patch.validation.checkedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Applies cleanly</dt>
                  <dd className={patch.validation.appliesCleanly ? "text-ok" : "text-danger"}>
                    {String(patch.validation.appliesCleanly)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Applied at</dt>
                  <dd className="font-mono">{formatDate(patch.appliedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Files</dt>
                  <dd className="mt-1 space-y-0.5">
                    {patch.files.length === 0 ? (
                      <span className="text-muted">none</span>
                    ) : (
                      patch.files.map((file) => (
                        <p key={file} className="truncate font-mono text-[11px]">
                          {file}
                        </p>
                      ))
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
