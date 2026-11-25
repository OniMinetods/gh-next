export const COMMENT_MAX_LENGTH = 65_536;

export const commentHideReasons = [
  "ABUSE",
  "OFF_TOPIC",
  "OUTDATED",
  "RESOLVED",
  "DUPLICATE",
  "SPAM"
] as const;

export type CommentHideReason = (typeof commentHideReasons)[number];

export const commentHideReasonLabels: Record<CommentHideReason, string> = {
  ABUSE: "Abuse",
  OFF_TOPIC: "Off topic",
  OUTDATED: "Outdated",
  RESOLVED: "Resolved",
  DUPLICATE: "Duplicate",
  SPAM: "Spam"
};
