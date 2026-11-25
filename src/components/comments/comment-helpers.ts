export function commentPermalink(issuePath: string, id: number) {
  return `${issuePath}?comment=${id}#issuecomment-${id}`;
}

export function getCommentRequest(
  previous: { id: string; content: string } | undefined,
  content: string,
  createId: () => string
) {
  return previous?.content === content ? previous : { id: createId(), content };
}

export function commentActionError(type: string) {
  switch (type) {
    case "AUTH_ERROR":
      return "Sign in again to continue.";
    case "FORBIDDEN":
      return "You do not have permission to make this change.";
    case "NOT_FOUND":
      return "This issue or comment is unavailable.";
    case "VERSION_CONFLICT":
      return "This comment changed. Review the latest version and try again.";
    case "REQUEST_CONFLICT":
      return "This submission was already used. Submit again to publish a new comment.";
    default:
      return "Could not save the comment. Try again.";
  }
}
