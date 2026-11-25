"use server";

import { revalidatePath } from "next/cache";
import { getAuthedUser } from "./auth.action";
import { withAuth, type AuthState } from "./middlewares";
import {
  getCommentHistory,
  listMyDeletedComments
} from "~/models/comments/read";
import {
  createIssueComment,
  deleteIssueComment,
  editIssueComment,
  hideIssueComment,
  restoreIssueComment,
  unhideIssueComment
} from "~/models/comments/write";
import {
  changeCommentInput,
  commentHistoryInput,
  createCommentInput,
  deletedCommentsInput,
  editCommentInput,
  hideCommentInput
} from "~/models/comments/validation";
import type { z } from "zod";

type MutationResult =
  | Awaited<ReturnType<typeof createIssueComment>>
  | Awaited<ReturnType<typeof editIssueComment>>;

function commentMutation<Input, Result extends MutationResult>(
  schema: z.ZodType<Input>,
  mutate: (input: Input, actor: AuthState["currentUser"]) => Promise<Result>
) {
  return withAuth(async (input: unknown, { currentUser }: AuthState) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { type: "INVALID_INPUT" as const, errors: parsed.error.flatten() };
    }

    let result;
    try {
      result = await mutate(parsed.data, currentUser);
    } catch (error) {
      console.error(
        "Comment transaction failed",
        error instanceof Error ? error.name : undefined
      );
      return { type: "WRITE_ERROR" as const };
    }

    if (result.type === "OK" && result.changed) {
      for (const path of [result.issuePath, result.issueListPath]) {
        try {
          revalidatePath(path);
        } catch (error) {
          console.error(
            "Comment revalidation failed",
            path,
            error instanceof Error ? error.name : undefined
          );
        }
      }
    }
    return result;
  });
}

const create = commentMutation(createCommentInput, createIssueComment);
const edit = commentMutation(editCommentInput, editIssueComment);
const remove = commentMutation(changeCommentInput, deleteIssueComment);
const restore = commentMutation(changeCommentInput, restoreIssueComment);
const hide = commentMutation(hideCommentInput, hideIssueComment);
const unhide = commentMutation(changeCommentInput, unhideIssueComment);

export async function createCommentAction(input: unknown) {
  return create(input);
}
export async function editCommentAction(input: unknown) {
  return edit(input);
}
export async function deleteCommentAction(input: unknown) {
  return remove(input);
}
export async function restoreCommentAction(input: unknown) {
  return restore(input);
}
export async function hideCommentAction(input: unknown) {
  return hide(input);
}
export async function unhideCommentAction(input: unknown) {
  return unhide(input);
}

export async function getCommentHistoryAction(input: unknown) {
  const parsed = commentHistoryInput.safeParse(input);
  if (!parsed.success) return { type: "INVALID_INPUT" as const };
  const { issueId, commentId, moderation } = parsed.data;
  const viewer = await getAuthedUser();
  const result = await getCommentHistory(issueId, commentId, viewer?.id, moderation);
  return result.type === "OK" ? { type: result.type, revisions: result.revisions } : result;
}

const deleted = withAuth(async (input: unknown, { currentUser }: AuthState) => {
  const parsed = deletedCommentsInput.safeParse(input);
  if (!parsed.success) return { type: "INVALID_INPUT" as const };
  return listMyDeletedComments(
    parsed.data.issueId,
    currentUser.id,
    parsed.data.cursor
  );
});

export async function getMyDeletedCommentsAction(input: unknown) {
  return deleted(input);
}
