import type { IssueCommentContext } from "./access";

export function commentPermissions(
  issue: Pick<IssueCommentContext, "ownerId" | "archived" | "locked">,
  viewerId: number | undefined,
  authorId?: number | null
) {
  const isOwner = viewerId !== undefined && viewerId === issue.ownerId;
  const canWrite = viewerId !== undefined && !issue.archived;

  return {
    canPublish: canWrite && (!issue.locked || isOwner),
    canManageOwn: canWrite && viewerId === authorId,
    canModerate: canWrite && isOwner,
    canReadModeration: isOwner
  };
}
