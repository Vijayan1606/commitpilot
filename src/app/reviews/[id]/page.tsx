import Link from "next/link";
import { notFound } from "next/navigation";
import { getJob, getReportByJobId, getReview, listFindings } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { FindingsList } from "@/components/analysis/FindingsList";
import { Card, CardHeader, PageHeader, Tag, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const review = getReview(id);
  if (!review) notFound();
  const repository = getRepository(review.repositoryId);
  const job = getJob(review.jobId);
  const findings = job ? listFindings(job.id) : [];
  const report = job ? getReportByJobId(job.id) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={repository?.name ?? "Removed repository"}
        title="Change review"
        description={review.summary ?? undefined}
        actions={
          <>
            {job ? (
              <Link className="btn btn-sm" href={`/analysis/${job.id}`}>
                Full run
              </Link>
            ) : null}
            {report ? (
              <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=md`}>
                Export .md
              </a>
            ) : null}
          </>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <Card>
          <CardHeader
            title="Change set"
            description={`Reviewed ${formatDate(review.createdAt)}`}
            actions={
              <div className="flex gap-1.5">
                <Tag tone="info">{review.mode}</Tag>
                {review.range ? <span className="chip">{review.range}</span> : null}
              </div>
            }
          />
          {review.changedFiles.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              No changed files were recorded. The diff was empty for this selection.
            </p>
          ) : (
            <ul className="divide-y divide-line/60">
              {review.changedFiles.map((file) => (
                <li key={file} className="px-4 py-2 font-mono text-[11px] text-muted">
                  {file}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={`Findings · ${findings.length}`}
            description="Every finding refers to the diff or is labelled as contextual."
          />
          <FindingsList findings={findings} repositoryId={repository?.id} />
        </Card>
      </div>
    </div>
  );
}
