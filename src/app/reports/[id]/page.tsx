import Link from "next/link";
import { notFound } from "next/navigation";
import { getReport } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { Markdown } from "@/components/reports/Markdown";
import { ReportDeleteButton } from "@/components/reports/ReportDeleteButton";
import { PageHeader, Tag, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = getReport(id);
  if (!report) notFound();
  const repository = getRepository(report.repositoryId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={repository?.name ?? "Removed repository"}
        title={report.title}
        description={`${report.reportType} · ${formatDate(report.createdAt)}`}
        actions={
          <>
            <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=md`}>
              Export .md
            </a>
            <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=json`}>
              Export .json
            </a>
            <ReportDeleteButton reportId={report.id} />
          </>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Tag tone="neutral">immutable snapshot</Tag>
          {repository ? (
            <Link className="chip hover:text-citron" href={`/repositories/${repository.id}`}>
              open repository
            </Link>
          ) : null}
          {report.jobId ? (
            <Link className="chip hover:text-citron" href={`/analysis/${report.jobId}`}>
              open analysis run
            </Link>
          ) : null}
        </div>

        <article className="panel px-5 py-5 sm:px-7 sm:py-6">
          <Markdown>{report.markdown}</Markdown>
        </article>
      </div>
    </div>
  );
}
