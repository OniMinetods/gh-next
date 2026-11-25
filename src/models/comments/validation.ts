import { z } from "zod";
import { commentHideReasonEnum } from "~/lib/server/db/schema/comment-hide-reason";

const maxPgInteger = 2_147_483_647;

export const issueCommentId = z.number().int().positive().max(maxPgInteger);

const content = z
  .string()
  .max(65_536)
  .refine((value) => value.trim().length > 0 && !value.includes("\0"), {
    message: "Enter a non-empty comment without null characters."
  });

export const createCommentInput = z
  .object({
    issueId: issueCommentId,
    clientRequestId: z.string().uuid(),
    content
  })
  .strict();

export const changeCommentInput = z
  .object({
    issueId: issueCommentId,
    commentId: issueCommentId,
    version: z.number().int().nonnegative().max(maxPgInteger)
  })
  .strict();

export const editCommentInput = changeCommentInput.extend({ content });

export const hideCommentInput = changeCommentInput.extend({
  reason: z.enum(commentHideReasonEnum.enumValues)
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
