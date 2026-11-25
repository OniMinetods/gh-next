import { describe, expect, it, vi } from "vitest";
import {
  commentActionError,
  commentPermalink,
  getCommentRequest
} from "~/components/comments/comment-helpers";

describe("comment submission", () => {
  it("keeps the request ID across retries of the same Markdown", () => {
    const createId = vi
      .fn()
      .mockReturnValueOnce("first")
      .mockReturnValueOnce("second");
    const first = getCommentRequest(undefined, "Unconfirmed draft", createId);
    expect(getCommentRequest(first, "Unconfirmed draft", createId)).toBe(first);
    expect(getCommentRequest(first, "Changed draft", createId)).toEqual({
      id: "second",
      content: "Changed draft"
    });
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it("uses the same stable link when the comment is edited", () => {
    expect(commentPermalink("/Fredkiss3/gh-next/issues/42", 305)).toBe(
      "/Fredkiss3/gh-next/issues/42?comment=305#issuecomment-305"
    );
  });

  it("gives actionable errors for a stale edit and an expired session", () => {
    expect(commentActionError("VERSION_CONFLICT")).toMatch(/latest version/i);
    expect(commentActionError("AUTH_ERROR")).toMatch(/sign in/i);
  });
});
