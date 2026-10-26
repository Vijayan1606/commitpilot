import Link from "next/link";
import { notFound } from "next/navigation";
import { SEVERITIES } from "@/shared/constants";
import { getJob, getReportByJobId, getReviewByJobId, listFindings } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { labelFor } from "@/server/analysis/orchestrator";
import { FindingsList } from "@/components/analysis/FindingsList";
import { JobMonitor } from "@/components/analysis/JobMonitor";
import {
  Card,
  CardHeader,
  Notice,
  PageHeader,
  SeverityBadge,
  Stat,
  Tag,
  formatDate,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  const repository = getRepository(job.repositoryId);
  const findings = listFindings(job.id);
  const report = getReportByJobId(job.id);
  const review = getReviewByJobId(job.id);
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    (typeof SEVERITIES)[number],
    number
  >;
  for (const finding of findings) counts[finding.severity] += 1;

  const terminal = ["completed", "failed", "cancelled"].includes(job.status);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={repository ? repository.name : "Removed repository"}
        title={labelFor(job.analysisType)}
        description={job.request?.split("|")[0] ?? undefined}
        actions={
          <>
            {repository ? (
              <Link className="btn btn-sm" href={`/repositories/${repository.id}`}>
                Repository
              </Link>
            ) : null}
            {report ? (
              <>
                <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=md`}>
                  Export .md
                </a>
                <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=json`}>
                  Export .json
                </a>
              </>
            ) : null}
          </>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Status"
            value={job.status}
            tone={job.status === "completed" ? "ok" : job.status === "failed" ? "danger" : "default"}
            hint={job.stage ?? undefined}
          />
          <Stat label="Findings" value={findings.length} hint={`${counts.critical} critical · ${counts.high} high`} />
          <Stat label="Model" value={job.modelName ?? "not used"} hint={job.modelProvider ?? undefined} />
          <Stat label="Started" value={formatDate(job.startedAt ?? job.createdAt)} hint={job.correlationId.slice(0, 12)} />
        </div>

        {!terminal ? (
          <Card>
            <CardHeader title="Run in progress" description="The report is written only after verification." />
            <JobMonitor
              jobId={job.id}
              initial={{
                id: job.id,
                status: job.status,
                stage: job.stage,
                progress: job.progress,
                errorCode: job.errorCode,
                errorMessage: job.errorMessage,
              }}
            />
          </Card>
        ) : null}

        {job.status === "failed" ? (
          <Notice tone="danger" title="This run failed">
            <span className="font-mono text-xs">{job.errorCode}</span> — {job.errorMessage}
            <p className="mt-2 text-xs text-muted">
              No findings were fabricated to fill the gap. Fix the configuration or repository issue and
              run it again.
            </p>
          </Notice>
        ) : null}

        {job.status === "cancelled" ? (
          <Notice tone="warn" title="This run was cancelled">
            Cancellation takes effect at the next checkpoint. A model request already in flight may still
            complete, but its result is not saved.
          </Notice>
        ) : null}

        {job.summary ? (
          <Card>
            <CardHeader
              title="Summary"
              description={
                job.modelName
                  ? "Written by the configured model from the supplied evidence."
                  : "Generated from this run's evidence. No model was used."
              }
            />
            <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-ink/90">{job.summary}</div>
          </Card>
        ) : null}

        {review ? (
          <Card>
            <CardHeader
              title="Change set"
              actions={
                <Link className="btn btn-sm" href={`/reviews/${review.id}`}>
                  Review detail
                </Link>
              }
            />
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
              <Tag tone="info">{review.mode}</Tag>
              {review.range ? <span className="chip">{review.range}</span> : null}
              <span className="text-muted">{review.changedFiles.length} changed file(s)</span>
            </div>
            {review.changedFiles.length > 0 ? (
              <ul className="border-t border-line/60 px-4 py-2">
                {review.changedFiles.slice(0, 20).map((file) => (
                  <li key={file} className="truncate font-mono text-[11px] text-muted">
                    {file}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title={`Findings · ${findings.length}`}
            description="Each finding is labelled by source and verification status."
            actions={
              <div className="flex gap-1.5">
                {SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
                  <span key={severity} className="flex items-center gap-1">
                    <SeverityBadge severity={severity} />
                    <span className="font-mono text-[10px] text-muted">{counts[severity]}</span>
                  </span>
                ))}
              </div>
            }
          />
          <FindingsList findings={findings} repositoryId={repository?.id} />
        </Card>

        {report ? (
          <Card>
            <CardHeader title="Saved report" description={`${report.reportType} · ${formatDate(report.createdAt)}`} />
            <div className="flex flex-wrap gap-2 px-4 py-4">
              <Link className="btn btn-sm" href={`/reports/${report.id}`}>
                Open report
              </Link>
              <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=md`}>
                Download Markdown
              </a>
              <a className="btn btn-sm" href={`/api/reports/${report.id}/export?format=json`}>
                Download JSON
              </a>
            </div>
          </Card>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted">
          Verification legend: <span className="font-mono">static_rule_match</span> is a deterministic
          pattern match and needs human confirmation. <span className="font-mono">path_verified_model_hypothesis</span>{" "}
          means the cited file exists but the claim is still an AI hypothesis. No finding is marked verified
          by a model.
        </p>
      </div>
    </div>
  );
}