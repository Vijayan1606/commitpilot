import Link from "next/link";
import { listReviews } from "@/server/db/analysis";
import { getRepository } from "@/server/db/repositories";
import { Card, EmptyState, PageHeader, Tag, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function ReviewsPage() {
  const reviews = listReviews(100);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Change review"
        title="Reviews"
        description="Every review is tied to a real Git diff or commit range. Reviews never invent findings to look comprehensive."
      />

      <div className="space-y-4 px-5 py-6 sm:px-8">
        {reviews.length === 0 ? (
          <EmptyState
            title="No reviews yet"
            description="Open a repository, choose Review diff, and run a review against your uncommitted changes."
            action={
              <Link className="btn btn-primary" href="/repositories">
                Choose a repository
              </Link>
            }
          />
        ) : (
          reviews.map((review) => {
            const repository = getRepository(review.repositoryId);
            return (
              <Card key={review.id} className="transition-colors hover:border-citron/30">
                <Link href={`/reviews/${review.id}`} className="block px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold">
                          {repository?.name ?? "Removed repository"}
                        </h2>
                        <Tag tone="info">{review.mode}</Tag>
                        {review.range ? <span className="chip">{review.range}</span> : null}
                      </div>
                      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
                        {review.summary ?? "No summary recorded."}
                      </p>
                    </div>
                    <div className="text-right text-[11px] text-muted">
                      <p>{review.changedFiles.length} files</p>
                      <p className="mt-0.5">{formatDate(review.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
