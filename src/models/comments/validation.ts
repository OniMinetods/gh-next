import { z } from "zod";
import { COMMENT_MAX_LENGTH, commentHideReasons } from "~/lib/shared/comment-options";

const maxPgInteger = 2_147_483_647;

export const issueCommentId = z.number().int().positive().max(maxPgInteger);

export const commentContent = z
  .string()
  .max(COMMENT_MAX_LENGTH)
  .refine((value) => value.trim().length > 0 && !value.includes("\0"), {
    message: "Enter a non-empty comment without null characters."
  });

export const createCommentInput = z
  .object({
    issueId: issueCommentId,
    clientRequestId: z.string().uuid(),
    content: commentContent
  })
  .strict();

export const changeCommentInput = z
  .object({
    issueId: issueCommentId,
    commentId: issueCommentId,
    version: z.number().int().nonnegative().max(maxPgInteger)
  })
  .strict();

export const editCommentInput = changeCommentInput.extend({ content: commentContent });

export const hideCommentInput = changeCommentInput.extend({
  reason: z.enum(commentHideReasons)
});

export const commentHistoryInput = z
  .object({
    issueId: issueCommentId,
    commentId: issueCommentId,
    moderation: z.boolean().optional()
  })
  .strict();

export const deletedCommentsInput = z
  .object({ issueId: issueCommentId, cursor: z.string().optional() })
  .strict();
