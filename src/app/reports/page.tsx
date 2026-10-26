import Link from "next/link";
import { listReports, listReportsForRepository } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { Card, EmptyState, PageHeader, Tag, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  analysis: "Repository analysis",
  review: "Code review",
  test_gaps: "Test gaps",
  security: "Security review",
  search: "Code search",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ repositoryId?: string }>;
}) {
  const params = await searchParams;
  const reports = params.repositoryId
    ? listReportsForRepository(params.repositoryId, 100)
    : listReports(100);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Evidence"
        title="Reports"
        description="Every completed analysis writes a report. Exports contain the findings, evidence, verification status, model configuration, and limitations — never credentials."
        actions={
          params.repositoryId ? (
            <Link className="btn btn-sm" href="/reports">
              All reports
            </Link>
          ) : null
        }
      />

      <div className="space-y-3 px-5 py-6 sm:px-8">
        {reports.length === 0 ? (
          <EmptyState
            title="No saved reports"
            description="Run an analysis or review. The report is written only after the findings have been verified against the repository."
            action={
              <Link className="btn btn-primary" href="/repositories">
                Choose a repository
              </Link>
            }
          />
        ) : (
          reports.map((report) => {
            const repository = getRepository(report.repositoryId);
            return (
              <Card key={report.id} className="transition-colors hover:border-citron/30">
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/reports/${report.id}`} className="truncate text-sm font-semibold hover:text-citron">
                        {report.title}
                      </Link>
                      <Tag tone="info">{TYPE_LABEL[report.reportType] ?? report.reportType}</Tag>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted">
                      {repository?.name ?? "removed"} · {formatDate(report.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="btn btn-sm" href={`/reports/${report.id}`}>
                      Open
                    </Link>
                    <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=md`}>
                      .md
                    </a>
                    <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=json`}>
                      .json
                    </a>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
