import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CacheKeys } from "~/lib/shared/cache-keys.shared";
import {
  decodeCommentCursor,
  encodeCommentCursor
} from "~/models/comments/cursor";
import { commentPermissions } from "~/models/comments/permissions";
import {
  changeCommentInput,
  createCommentInput,
  hideCommentInput
} from "~/models/comments/validation";

vi.mock("server-only", () => ({}));

describe("comment server inputs", () => {
  it("preserves the submitted Markdown and rejects empty, oversized or forged input", () => {
    const base = {
      issueId: 1,
      clientRequestId: randomUUID(),
      content: "## Heading\n  text"
    };
    expect(createCommentInput.parse(base).content).toBe(base.content);
    for (const content of ["  \n\t", "text\0", "a".repeat(65_537)]) {
      expect(createCommentInput.safeParse({ ...base, content }).success).toBe(
        false
      );
    }
    expect(createCommentInput.safeParse({ ...base, authorId: 5 }).success).toBe(
      false
    );
    expect(
      createCommentInput.safeParse({ ...base, clientRequestId: "invalid" })
        .success
    ).toBe(false);
  });

  it("requires PostgreSQL-range IDs, a valid version and a supported hide reason", () => {
    const base = { issueId: 1, commentId: 2, version: 0 };
    expect(changeCommentInput.safeParse(base).success).toBe(true);
    expect(
      changeCommentInput.safeParse({ ...base, issueId: 2_147_483_648 }).success
    ).toBe(false);
    expect(changeCommentInput.safeParse({ ...base, version: -1 }).success).toBe(
      false
    );
    expect(
      hideCommentInput.safeParse({ ...base, reason: "SPAM" }).success
    ).toBe(true);
    expect(
      hideCommentInput.safeParse({ ...base, reason: "UNKNOWN" }).success
    ).toBe(false);
  });

  it("round-trips a scoped microsecond cursor and falls back for malformed cursors", () => {
    const createdAt = "2024-02-29T01:02:03.123456";
    const cursor = encodeCommentCursor([42, createdAt, 7]);
    expect(decodeCommentCursor(cursor, 42)).toEqual({ createdAt, id: 7 });
    expect(decodeCommentCursor(cursor, 43)).toBeNull();
    for (const invalid of [
      undefined,
      "bad!",
      "a".repeat(129),
      encodeCommentCursor([42, "2024-02-30T01:02:03.123456", 7])
    ]) {
      expect(decodeCommentCursor(invalid, 42)).toBeNull();
    }
  });

  it("distinguishes authors, owners and guests in locked and archived discussions", () => {
    const locked = { ownerId: 1, archived: false, locked: true };
    expect(commentPermissions(locked, undefined, 2)).toEqual({
      canPublish: false,
      canManageOwn: false,
      canModerate: false,
      canReadModeration: false
    });
    expect(commentPermissions(locked, 2, 2)).toMatchObject({
      canPublish: false,
      canManageOwn: true,
      canModerate: false
    });
    expect(commentPermissions(locked, 1, 2)).toMatchObject({
      canPublish: true,
      canManageOwn: false,
      canModerate: true
    });
    expect(commentPermissions(locked, 2, null).canManageOwn).toBe(false);
    expect(commentPermissions({ ...locked, archived: true }, 1, 1)).toEqual({
      canPublish: false,
      canManageOwn: false,
      canModerate: false,
      canReadModeration: true
    });
  });

  it("scopes comment Markdown keys by repository and revision", () => {
    expect(CacheKeys.commentMarkdown(1, 2, 0)).not.toEqual(
      CacheKeys.commentMarkdown(1, 2, 1)
    );
    expect(CacheKeys.commentMarkdown(1, 2, 0)).not.toEqual(
      CacheKeys.commentMarkdown(3, 2, 0)
    );
  });
});
