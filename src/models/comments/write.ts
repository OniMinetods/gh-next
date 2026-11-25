import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "~/lib/server/db/index.server";
import { comments, commentRevisions } from "~/lib/server/db/schema/comment.sql";
import { issueEvents } from "~/lib/server/db/schema/event.sql";
import { lockIssueCommentContext } from "./access";
import { commentPermissions } from "./permissions";
import { commentDisplay, commentNotFound, findIssueComment } from "./read";
import type { z } from "zod";
import type {
  Comment,
  CommentInsert
} from "~/lib/server/db/schema/comment.sql";
import type { EventType } from "~/lib/server/db/schema/event.sql";
import type { User } from "~/lib/server/db/schema/user.sql";
import type { CommentTransaction, IssueCommentContext } from "./access";
import type {
  changeCommentInput,
  createCommentInput,
  editCommentInput,
  hideCommentInput
} from "./validation";

type Actor = Pick<User, "id" | "username" | "avatar_url">;
type CreateInput = z.infer<typeof createCommentInput>;
type ChangeInput = z.infer<typeof changeCommentInput>;
type EditInput = z.infer<typeof editCommentInput>;
type HideInput = z.infer<typeof hideCommentInput>;

const forbidden = { type: "FORBIDDEN" } as const;

async function mutationReceipt(
  tx: CommentTransaction,
  context: IssueCommentContext,
  id: number,
  changed: boolean
) {
  const row = await findIssueComment(tx, context.issueId, id);
  if (!row) throw new Error("Comment disappeared during its transaction.");
  const issueListPath = `/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repository)}/issues`;
  return {
    type: "OK" as const,
    changed,
    comment: commentDisplay(row, context),
    version: row.version,
    issueListPath,
    issuePath: `${issueListPath}/${context.number}`
  };
}

async function recordEvent(
  tx: CommentTransaction,
  issueId: number,
  commentId: number,
  actor: Actor,
  type: EventType,
  reason?: Comment["hidden_reason"]
) {
  await tx.insert(issueEvents).values({
    issue_id: issueId,
    comment_id: commentId,
    initiator_id: actor.id,
    initiator_username: actor.username,
    initiator_avatar_url: actor.avatar_url,
    type,
    comment_hidden_reason: reason
  });
}

export async function createIssueComment(input: CreateInput, actor: Actor) {
  const digest = createHash("sha256").update(input.content).digest("hex");
  return db.transaction(async (tx) => {
    const context = await lockIssueCommentContext(tx, input.issueId);
    if (!context) return commentNotFound;

    function existingRequest() {
      return tx
        .select({ id: comments.id, digest: comments.create_body_digest })
        .from(comments)
        .where(
          and(
            eq(comments.issue_id, input.issueId),
            eq(comments.author_id, actor.id),
            eq(comments.client_request_id, input.clientRequestId)
          )
        );
    }

    const [prior] = await existingRequest();
    if (prior) {
      return prior.digest === digest
        ? mutationReceipt(tx, context, prior.id, false)
        : { type: "REQUEST_CONFLICT" as const };
    }

    if (!commentPermissions(context, actor.id).canPublish) return forbidden;

    // Drizzle 0.28 puts the predicate after DO NOTHING for targeted partial indexes.
    const [created] = await tx
      .insert(comments)
      .values({
        issue_id: input.issueId,
        author_id: actor.id,
        author_username: actor.username,
        author_avatar_url: actor.avatar_url,
        content: input.content,
        client_request_id: input.clientRequestId,
        create_body_digest: digest
      })
      .onConflictDoNothing()
      .returning({ id: comments.id });

    if (created) {
      await recordEvent(tx, input.issueId, created.id, actor, "ADD_COMMENT");
      return mutationReceipt(tx, context, created.id, true);
    }

    const [raced] = await existingRequest();
    if (!raced)
      throw new Error("Comment request conflicted without an existing row.");
    return raced.digest === digest
      ? mutationReceipt(tx, context, raced.id, false)
      : { type: "REQUEST_CONFLICT" as const };
  });
}

type Change =
  | { type: "edit"; content: string }
  | { type: "delete" }
  | { type: "restore" }
  | { type: "hide"; reason: HideInput["reason"] }
  | { type: "unhide" };

async function mutateComment(input: ChangeInput, actor: Actor, change: Change) {
  return db.transaction(async (tx) => {
    const context = await lockIssueCommentContext(tx, input.issueId);
    if (!context) return commentNotFound;
    const [comment] = await tx
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.issue_id, input.issueId),
          eq(comments.id, input.commentId)
        )
      )
      .for("update");
    if (!comment) return commentNotFound;

    const moderation = change.type === "hide" || change.type === "unhide";
    const permissions = commentPermissions(
      context,
      actor.id,
      comment.author_id
    );
    if (!(moderation ? permissions.canModerate : permissions.canManageOwn)) {
      return forbidden;
    }
    if (change.type === "edit" && (comment.hidden || comment.deleted_at))
      return forbidden;

    const now = new Date();
    let updates: Partial<CommentInsert>;
    let event: EventType | undefined;
    let reason: Comment["hidden_reason"] | undefined;

    switch (change.type) {
      case "edit":
        if (comment.version !== input.version)
          return {
            type: "VERSION_CONFLICT" as const,
            version: comment.version
          };
        if (comment.content === change.content)
          return mutationReceipt(tx, context, comment.id, false);
        updates = { content: change.content, edited_at: now };
        break;
      case "delete":
        if (comment.deleted_at)
          return mutationReceipt(tx, context, comment.id, false);
        updates = { deleted_at: now, deleted_by: actor.id };
        event = "DELETE_COMMENT";
        break;
      case "restore":
        if (!comment.deleted_at)
          return mutationReceipt(tx, context, comment.id, false);
        updates = { deleted_at: null, deleted_by: null };
        event = "RESTORE_COMMENT";
        break;
      case "hide":
        if (comment.hidden && comment.hidden_reason === change.reason) {
          return mutationReceipt(tx, context, comment.id, false);
        }
        updates = { hidden: true, hidden_reason: change.reason };
        event = "HIDE_COMMENT";
        reason = change.reason;
        break;
      case "unhide":
        if (!comment.hidden)
          return mutationReceipt(tx, context, comment.id, false);
        updates = { hidden: false, hidden_reason: null };
        event = "UNHIDE_COMMENT";
        reason = comment.hidden_reason;
        break;
    }

    if (comment.version !== input.version) {
      return { type: "VERSION_CONFLICT" as const, version: comment.version };
    }

    const [updated] = await tx
      .update(comments)
      .set({ ...updates, version: comment.version + 1 })
      .where(
        and(
          eq(comments.id, comment.id),
          eq(comments.issue_id, input.issueId),
          eq(comments.version, input.version)
        )
      )
      .returning({ id: comments.id });
    if (!updated)
      throw new Error("Comment version changed while the row was locked.");

    if (change.type === "edit") {
      await tx.insert(commentRevisions).values({
        comment_id: comment.id,
        editor_id: actor.id,
        format: "MARKDOWN_SNAPSHOT",
        created_at: now,
        updated_content: comment.content
      });
    } else if (event) {
      await recordEvent(tx, input.issueId, comment.id, actor, event, reason);
    }

    return mutationReceipt(tx, context, comment.id, true);
  });
}

export function editIssueComment(input: EditInput, actor: Actor) {
  return mutateComment(input, actor, { type: "edit", content: input.content });
}

export function deleteIssueComment(input: ChangeInput, actor: Actor) {
  return mutateComment(input, actor, { type: "delete" });
}

export function restoreIssueComment(input: ChangeInput, actor: Actor) {
  return mutateComment(input, actor, { type: "restore" });
}

export function hideIssueComment(input: HideInput, actor: Actor) {
  return mutateComment(input, actor, { type: "hide", reason: input.reason });
}

export function unhideIssueComment(input: ChangeInput, actor: Actor) {
  return mutateComment(input, actor, { type: "unhide" });
}
