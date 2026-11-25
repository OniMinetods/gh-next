import "server-only";
import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "~/lib/server/db/index.server";
import { comments } from "~/lib/server/db/schema/comment.sql";
import { issues } from "~/lib/server/db/schema/issue.sql";
import { issueUserMentions } from "~/lib/server/db/schema/mention.sql";
import { repositories } from "~/lib/server/db/schema/repository.sql";
import { users } from "~/lib/server/db/schema/user.sql";

export type CommentTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export const publicIssueRepository = eq(repositories.is_public, true);

export const visibleComment = and(
  eq(comments.hidden, false),
  isNull(comments.deleted_at)
);

const mentionComment = alias(comments, "mention_comment");

export const visibleIssueMention = or(
  isNull(issueUserMentions.comment_id),
  exists(
    db
      .select({ id: mentionComment.id })
      .from(mentionComment)
      .where(
        and(
          eq(mentionComment.id, issueUserMentions.comment_id),
          eq(mentionComment.issue_id, issueUserMentions.issue_id),
          eq(mentionComment.hidden, false),
          isNull(mentionComment.deleted_at)
        )
      )
  )
);

const repositoryFields = {
  repositoryId: repositories.id,
  ownerId: repositories.creator_id,
  owner: users.username,
  repository: repositories.name,
  archived: repositories.is_archived
};

const issueFields = {
  issueId: issues.id,
  number: issues.number,
  locked: issues.is_locked
};

export async function getIssueCommentContext(
  connection: typeof db | CommentTransaction,
  issueId: number
) {
  const [context] = await connection
    .select({ ...repositoryFields, ...issueFields })
    .from(issues)
    .innerJoin(repositories, eq(issues.repository_id, repositories.id))
    .innerJoin(users, eq(repositories.creator_id, users.id))
    .where(and(eq(issues.id, issueId), publicIssueRepository));
  return context;
}

export async function lockIssueCommentContext(
  tx: CommentTransaction,
  issueId: number
) {
  // Acquire the repository lock before the issue lock. Recheck membership after both.
  const [repository] = await tx
    .select(repositoryFields)
    .from(repositories)
    .innerJoin(users, eq(repositories.creator_id, users.id))
    .where(
      and(
        publicIssueRepository,
        eq(
          repositories.id,
          sql`(${tx.select({ id: issues.repository_id }).from(issues).where(eq(issues.id, issueId))})`
        )
      )
    )
    .for("share", { of: repositories });
  if (!repository) return undefined;

  const [issue] = await tx
    .select(issueFields)
    .from(issues)
    .where(
      and(
        eq(issues.id, issueId),
        eq(issues.repository_id, repository.repositoryId)
      )
    )
    .for("share");
  return issue ? { ...repository, ...issue } : undefined;
}

export type IssueCommentContext = NonNullable<
  Awaited<ReturnType<typeof getIssueCommentContext>>
>;
