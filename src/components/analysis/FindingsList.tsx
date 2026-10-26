import Link from "next/link";
import type { FindingRecord } from "@/shared/types";
import { SeverityBadge, Tag, VerificationBadge } from "@/components/ui";

export function FindingsList({
  findings,
  repositoryId,
}: {
  findings: FindingRecord[];
  repositoryId?: string;
}) {
  if (findings.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-medium">No findings for this run</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
          That is a real result, not a placeholder. It does not prove the code is correct; it means the
          supplied evidence did not support a finding.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line/60">
      {findings.map((finding, index) => (
        <li key={finding.id} className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted">{String(index + 1).padStart(2, "0")}</span>
            <SeverityBadge severity={finding.severity} />
            <Tag tone="neutral">{finding.category}</Tag>
            <VerificationBadge status={finding.verificationStatus} />
            <Tag tone={finding.source === "model" ? "info" : "warn"}>
              {finding.source === "model" ? "AI hypothesis" : "deterministic"}
            </Tag>
          </div>

          <h3 className="mt-2 text-sm font-semibold leading-snug">{finding.title}</h3>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {finding.filePath ? (
              <span className="font-mono text-citron/90">
                {finding.filePath}
                {finding.startLine ? `:${finding.startLine}` : ""}
                {finding.endLine && finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}
              </span>
            ) : (
              <span>no verified file reference</span>
            )}
            <span>confidence: {finding.confidence}</span>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink/85">
            {finding.description}
          </p>

          {finding.evidence ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line/60 bg-canvas/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink/80">
              {finding.evidence}
            </pre>
          ) : null}

          {finding.remediation ? (
            <div className="mt-2 rounded border border-citron/20 bg-citron/5 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-citron/80">
                Suggested remediation
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-ink/85">
                {finding.remediation}
              </p>
            </div>
          ) : null}

          {finding.filePath && repositoryId ? (
            <div className="mt-2">
              <Link
                className="text-[11px] text-muted underline-offset-4 hover:text-citron hover:underline"
                href={`/patches?repositoryId=${repositoryId}&findingId=${finding.id}`}
              >
                Propose a patch for this finding →
              </Link>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}