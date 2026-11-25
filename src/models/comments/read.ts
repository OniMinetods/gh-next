import "server-only";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "~/lib/server/db/index.server";
import { comments, commentRevisions } from "~/lib/server/db/schema/comment.sql";
import { CacheKeys } from "~/lib/shared/cache-keys.shared";
import { MAX_ITEMS_PER_PAGE } from "~/lib/shared/constants";
import { getIssueCommentContext, visibleComment } from "./access";
import { decodeCommentCursor, encodeCommentCursor } from "./cursor";
import { commentPermissions } from "./permissions";
import type { SQL } from "drizzle-orm";
import type { CommentTransaction, IssueCommentContext } from "./access";

export const commentNotFound = { type: "NOT_FOUND" } as const;

const cursorTimestamp = sql<string>`to_char(${comments.created_at}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

const commentFields = {
  id: comments.id,
  version: comments.version,
  content: comments.content,
  createdAt: comments.created_at,
  cursorTimestamp,
  editedAt: sql`coalesce(${comments.edited_at}, (
    select max(revision.created_at)
    from ${commentRevisions} as revision
    where revision.comment_id = ${comments}.${sql.identifier(comments.id.name)}
  ))`.mapWith(comments.created_at) as SQL<Date | null>,
  deletedAt: comments.deleted_at,
  hidden: comments.hidden,
  hiddenReason: comments.hidden_reason,
  authorId: comments.author_id,
  authorUsername: comments.author_username,
  authorAvatarUrl: comments.author_avatar_url
};

type CommentRow = NonNullable<Awaited<ReturnType<typeof findIssueComment>>>;

export async function findIssueComment(
  tx: CommentTransaction,
  issueId: number,
  commentId: number
) {
  const [row] = await tx
    .select(commentFields)
    .from(comments)
    .where(and(eq(comments.issue_id, issueId), eq(comments.id, commentId)));
  return row;
}

export function visibleCommentData(
  comment: CommentRow,
  context: IssueCommentContext
) {
  return {
    state: "visible" as const,
    id: comment.id,
    version: comment.version,
    content: comment.content,
    author: {
      id: comment.authorId,
      username: comment.authorUsername,
      avatarUrl: comment.authorAvatarUrl
    },
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    markdownCacheKey: CacheKeys.commentMarkdown(
      context.repositoryId,
      comment.id,
      comment.version
    )
  };
}

export function commentDisplay(
  comment: CommentRow,
  context: IssueCommentContext
) {
  if (comment.deletedAt) return { id: comment.id, state: "deleted" as const };
  if (comment.hidden) {
    return {
      id: comment.id,
      state: "hidden" as const,
      reason: comment.hiddenReason
    };
  }
  return visibleCommentData(comment, context);
}

function commentPageCursor(
  issueId: number,
  rows: { cursorTimestamp: string; id: number }[]
) {
  if (rows.length <= MAX_ITEMS_PER_PAGE) return null;
  const last = rows[MAX_ITEMS_PER_PAGE - 1];
  return encodeCommentCursor([issueId, last.cursorTimestamp, last.id]);
}

function afterCursor(cursor: string | undefined, issueId: number) {
  const page = decodeCommentCursor(cursor, issueId);
  return page
    ? sql`(${comments.created_at}, ${comments.id}) > (${page.createdAt}::timestamp, ${page.id})`
    : undefined;
}

const readSnapshot = {
  isolationLevel: "repeatable read",
  accessMode: "read only"
} as const;

export async function listIssueComments(
  issueId: number,
  options: { cursor?: string; focusId?: number } = {}
) {
  return db.transaction(async (tx) => {
    const context = await getIssueCommentContext(tx, issueId);
    if (!context) return commentNotFound;

    let start = afterCursor(options.cursor, issueId);
    let focus;
    if (options.focusId !== undefined) {
      const target = await findIssueComment(tx, issueId, options.focusId);
      if (!target) return commentNotFound;
      const display = commentDisplay(target, context);
      focus =
        display.state === "visible"
          ? { id: target.id, state: display.state }
          : display;
      if (display.state === "visible") {
        start = sql`(${comments.created_at}, ${comments.id}) >= (${target.cursorTimestamp}::timestamp, ${target.id})`;
      }
    }

    const rows = await tx
      .select(commentFields)
      .from(comments)
      .where(and(eq(comments.issue_id, issueId), visibleComment, start))
      .orderBy(asc(comments.created_at), asc(comments.id))
      .limit(MAX_ITEMS_PER_PAGE + 1);

    return {
      type: "OK" as const,
      comments: rows
        .slice(0, MAX_ITEMS_PER_PAGE)
        .map((row) => visibleCommentData(row, context)),
      nextCursor: commentPageCursor(issueId, rows),
      focus
    };
  }, readSnapshot);
}

export async function listMyDeletedComments(
  issueId: number,
  authorId: number,
  cursor?: string
) {
  return db.transaction(async (tx) => {
    if (!(await getIssueCommentContext(tx, issueId))) return commentNotFound;

    const rows = await tx
      .select({
        id: comments.id,
        version: comments.version,
        deletedAt: comments.deleted_at,
        cursorTimestamp
      })
      .from(comments)
      .where(
        and(
          eq(comments.issue_id, issueId),
          eq(comments.author_id, authorId),
          isNotNull(comments.deleted_at),
          afterCursor(cursor, issueId)
        )
      )
      .orderBy(asc(comments.created_at), asc(comments.id))
      .limit(MAX_ITEMS_PER_PAGE + 1);

    return {
      type: "OK" as const,
      comments: rows
        .slice(0, MAX_ITEMS_PER_PAGE)
        .map(({ id, version, deletedAt }) => ({ id, version, deletedAt })),
      nextCursor: commentPageCursor(issueId, rows)
    };
  }, readSnapshot);
}

export async function getCommentHistory(
  issueId: number,
  commentId: number,
  viewerId: number | undefined,
  moderation = false
) {
  return db.transaction(async (tx) => {
    const context = await getIssueCommentContext(tx, issueId);
    if (
      !context ||
      (moderation && !commentPermissions(context, viewerId).canReadModeration)
    )
      return commentNotFound;

    const comment = await findIssueComment(tx, issueId, commentId);
    if (
      !comment ||
      ((comment.hidden || comment.deletedAt) && !(moderation && comment.hidden))
    ) {
      return commentNotFound;
    }

    const revisions = await tx
      .select({
        id: commentRevisions.id,
        editorId: commentRevisions.editor_id,
        createdAt: commentRevisions.created_at,
        format: commentRevisions.format,
        content: commentRevisions.updated_content
      })
      .from(commentRevisions)
      .where(eq(commentRevisions.comment_id, comment.id))
      .orderBy(desc(commentRevisions.created_at), desc(commentRevisions.id));

    return { type: "OK" as const, revisions };
  }, readSnapshot);
}
