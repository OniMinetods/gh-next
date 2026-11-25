import { pgEnum } from "drizzle-orm/pg-core";
import { commentHideReasons } from "~/lib/shared/comment-options";

export const commentHideReasonEnum = pgEnum("comment_hide_reason", [...commentHideReasons]);
