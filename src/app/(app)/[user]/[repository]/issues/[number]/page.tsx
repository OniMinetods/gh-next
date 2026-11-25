import "server-only";

// components
import { MarkdownTitle } from "~/components/markdown/markdown-title";
import { Markdown } from "~/components/markdown/markdown";
import { CommentList } from "~/components/comments/comment-list";

// utils
import { notFound } from "next/navigation";
import { preprocess, z } from "zod";
import { CacheKeys } from "~/lib/shared/cache-keys.shared";
import { getSingleIssue } from "~/models/issues";

// types
import type { Metadata } from "next";
import type { PageProps } from "~/lib/types";

type IssueDetailPageProps = PageProps<{
  user: string;
  repository: string;
  number: string;
}, {
  cursor: string;
  comment: string;
  deleted: string;
  hidden: string;
}>;

const issueParamsSchema = z.object({
  number: preprocess((arg) => Number(arg), z.number().int().positive().max(2_147_483_647)),
  user: z.string().min(1),
  repository: z.string().min(1)
});

export async function generateMetadata({
  params
}: IssueDetailPageProps): Promise<Metadata> {
  const paramsResult = issueParamsSchema.safeParse(params);

  if (!paramsResult.success) {
    notFound();
  }

  const issue = await getSingleIssue(
    paramsResult.data.user,
    paramsResult.data.repository,
    paramsResult.data.number
  );

  if (!issue) {
    notFound();
  }

  return {
    title: `${issue.title} · Issue #${params.number}`
  };
}

export default async function IssueDetailPage({
  params,
  searchParams
}: IssueDetailPageProps) {
  const paramsResult = issueParamsSchema.safeParse(params);

  if (!paramsResult.success) {
    notFound();
  }

  const user = paramsResult.data.user;
  const repo = paramsResult.data.repository;
  const issueNo = paramsResult.data.number;

  const issue = await getSingleIssue(user, repo, issueNo);
  if (!issue) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="px-5 border-b border-neutral py-5">
        <h1 className="flex gap-3 flex-wrap text-3xl">
          <bdi>
            <MarkdownTitle title={issue.title} />
          </bdi>
          <span className="text-grey">#{issue.number}</span>
        </h1>
      </section>

      <section className="px-5 flex flex-col gap-5">
        <Markdown
          cacheKey={CacheKeys.issues({
            user: params.user,
            repo: params.repository,
            number: issueNo,
            updatedAt: issue.updated_at
          })}
          content={issue.body}
          repository={`${user}/${repo}`}
        />
      </section>
      <CommentList issueId={issue.id} searchParams={searchParams} />
    </div>
  );
}
