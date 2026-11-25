import { pgEnum } from "drizzle-orm/pg-core";

export const commentHideReasonEnum = pgEnum("comment_hide_reason", [
  "ABUSE",
  "OFF_TOPIC",
  "OUTDATED",
  "RESOLVED",
  "DUPLICATE",
  "SPAM"
]);
