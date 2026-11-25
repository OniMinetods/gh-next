import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle as drizzleImporter } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { importEmptyIssueDiscussion } from "../../scripts/issue-discussion-import";
import { comments, commentRevisions } from "~/lib/server/db/schema/comment.sql";
import { issueEvents } from "~/lib/server/db/schema/event.sql";
import { issues } from "~/lib/server/db/schema/issue.sql";
import { issueUserMentions } from "~/lib/server/db/schema/mention.sql";
import { reactions } from "~/lib/server/db/schema/reaction.sql";
import { repositories } from "~/lib/server/db/schema/repository.sql";
import { users, type User } from "~/lib/server/db/schema/user.sql";
import { parseIssueFilterTokens } from "~/lib/shared/utils.shared";
import { setupCommentDatabase } from "./comment-database";

type TestDatabase = Awaited<ReturnType<typeof setupCommentDatabase>>;

const mocks = vi.hoisted(() => ({
  database: undefined as TestDatabase["db"] | undefined,
  actor: null as User | null,
  revalidatePath: vi.fn(),
  addFlash: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("~/actions/auth.action", () => ({
  getAuthedUser: async () => mocks.actor
}));
vi.mock("~/actions/session.action", () => ({
  getSession: async () => ({ addFlash: mocks.addFlash })
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  unstable_cache: (fn: unknown) => fn
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: (fn: unknown) => fn
}));
vi.mock("~/lib/server/rsc-utils.server", () => ({
  nextCache: (fn: unknown) => fn
}));
vi.mock("~/lib/server/db/index.server", () => ({ db: mocks.database }));

let testDatabase: TestDatabase;
let actions: typeof import("~/actions/comment.action");
let readers: typeof import("~/models/comments/read");
let issueModels: typeof import("~/models/issues");
let searchIssues: (typeof import("~/models/issues/search"))["searchIssues"];
let owner: User;
let author: User;
let outsider: User;
let failingActor: User;
let publicRepo: number;
let privateRepo: number;
let archivedRepo: number;
let issueNumber = 0;

beforeAll(async () => {
  testDatabase = await setupCommentDatabase();
  mocks.database = testDatabase.db;
  actions = await import("~/actions/comment.action");
  readers = await import("~/models/comments/read");
  issueModels = await import("~/models/issues");
  ({ searchIssues } = await import("~/models/issues/search"));

  [owner, author, outsider, failingActor] = await testDatabase.db
    .insert(users)
    .values(
      ["owner", "author", "outsider", "failing-event-actor"].map(
        (username) => ({
          username,
          github_id: username,
          avatar_url: "/fixture.png"
        })
      )
    )
    .returning();
  const repos = await testDatabase.db
    .insert(repositories)
    .values([
      { name: "public-fixture", creator_id: owner.id },
      { name: "private-fixture", creator_id: owner.id, is_public: false },
      { name: "archived-fixture", creator_id: owner.id, is_archived: true }
    ])
    .returning();
  [publicRepo, privateRepo, archivedRepo] = repos.map(({ id }) => id);

  await testDatabase.pool.query(
    "ALTER TABLE gh_next_comment_revisions ADD CHECK (updated_content <> 'reject revision fixture')"
  );
  await testDatabase.pool.query(
    "ALTER TABLE gh_next_issue_events ADD CHECK (initiator_username <> 'failing-event-actor')"
  );
}, 30_000);

afterAll(async () => {
  await testDatabase?.close();
});
beforeEach(() => {
  mocks.actor = author;
  mocks.revalidatePath.mockReset();
  mocks.addFlash.mockReset();
});

async function issue(repoId = publicRepo, locked = false) {
  const [row] = await testDatabase.db
    .insert(issues)
    .values({
      repository_id: repoId,
      number: ++issueNumber,
      title: "Integration discussion",
      author_id: owner.id,
      author_username: owner.username,
      author_avatar_url: owner.avatar_url,
      is_locked: locked
    })
    .returning();
  return row;
}

async function publish(
  issueId: number,
  content: string,
  clientRequestId = randomUUID()
) {
  const result = await actions.createCommentAction({
    issueId,
    content,
    clientRequestId
  });
  if (result.type !== "OK")
    throw new Error("Expected successful publication, got " + result.type);
  return result;
}

function target(issueId: number, commentId: number, version: number) {
  return { issueId, commentId, version };
}

it("blocks guest and forged writes, mismatched targets, private, archived and locked issues", async () => {
  const publicIssue = await issue();
  const privateIssue = await issue(privateRepo);
  const archive = await issue(archivedRepo);
  const locked = await issue(publicRepo, true);
  const payload = {
    issueId: publicIssue.id,
    clientRequestId: randomUUID(),
    content: "Hello"
  };

  mocks.actor = null;
  expect(await actions.createCommentAction(payload)).toEqual({
    type: "AUTH_ERROR"
  });
  expect(mocks.addFlash).toHaveBeenCalledTimes(1);

  mocks.actor = author;
  expect(
    await actions.createCommentAction({ ...payload, authorId: owner.id })
  ).toMatchObject({ type: "INVALID_INPUT" });
  expect(
    await actions.createCommentAction({ ...payload, content: " " })
  ).toMatchObject({ type: "INVALID_INPUT" });
  expect(
    await actions.createCommentAction({ ...payload, issueId: privateIssue.id })
  ).toEqual({ type: "NOT_FOUND" });
  expect(await readers.listIssueComments(privateIssue.id)).toEqual({
    type: "NOT_FOUND"
  });
  expect(
    await issueModels.getSingleIssue(
      owner.username,
      "private-fixture",
      privateIssue.number
    )
  ).toBeNull();
  expect(
    await actions.createCommentAction({ ...payload, issueId: archive.id })
  ).toEqual({ type: "FORBIDDEN" });
  expect(
    await actions.createCommentAction({ ...payload, issueId: locked.id })
  ).toEqual({ type: "FORBIDDEN" });

  const { comment } = await publish(publicIssue.id, "Hello");
  expect(
    await actions.getCommentHistoryAction({
      issueId: locked.id,
      commentId: comment.id
    })
  ).toEqual({ type: "NOT_FOUND" });
  expect(
    await actions.deleteCommentAction(target(locked.id, comment.id, 0))
  ).toEqual({ type: "NOT_FOUND" });
  mocks.actor = outsider;
  expect(
    await actions.editCommentAction({
      ...target(publicIssue.id, comment.id, 0),
      content: "Wrong author"
    })
  ).toEqual({ type: "FORBIDDEN" });
  expect(
    await actions.deleteCommentAction(target(publicIssue.id, comment.id, 0))
  ).toEqual({ type: "FORBIDDEN" });

  mocks.actor = owner;
  await publish(locked.id, "Owner can still post");
});

it("resolves competing creates to one ID and preserves the original request fingerprint through edits", async () => {
  const { id } = await issue();
  const key = randomUUID();
  const [first, second] = await Promise.all([
    publish(id, "Original", key),
    publish(id, "Original", key)
  ]);
  expect(first.comment.id).toBe(second.comment.id);
  expect([first.changed, second.changed].sort()).toEqual([false, true]);
  expect(mocks.revalidatePath.mock.calls).toEqual([
    [first.issuePath],
    [first.issueListPath]
  ]);

  const commentId = first.comment.id;
  expect(
    await actions.editCommentAction({
      ...target(id, commentId, 0),
      content: "Edited"
    })
  ).toMatchObject({ type: "OK", version: 1, comment: { content: "Edited" } });
  expect(await publish(id, "Original", key)).toMatchObject({
    changed: false,
    comment: { id: commentId }
  });
  expect(
    await actions.createCommentAction({
      issueId: id,
      content: "Edited",
      clientRequestId: key
    })
  ).toEqual({ type: "REQUEST_CONFLICT" });

  const rows = await testDatabase.db
    .select()
    .from(issueEvents)
    .where(eq(issueEvents.comment_id, commentId));
  expect(rows.map(({ type }) => type)).toEqual(["ADD_COMMENT"]);

  mocks.actor = outsider;
  expect((await publish(id, "Another author", key)).comment.id).not.toBe(
    commentId
  );
});

it("preserves the display date and creates exactly one previous Markdown revision for a competing edit", async () => {
  const { id } = await issue();
  const { comment } = await publish(id, "Before");
  const input = target(id, comment.id, 0);
  const results = await Promise.all([
    actions.editCommentAction({ ...input, content: "First" }),
    actions.editCommentAction({ ...input, content: "Second" })
  ]);
  expect(results.map((result) => result.type).sort()).toEqual([
    "OK",
    "VERSION_CONFLICT"
  ]);
  const success = results.find((result) => result.type === "OK");
  if (
    success?.type !== "OK" ||
    success.comment.state !== "visible" ||
    comment.state !== "visible"
  ) {
    throw new Error("Expected editable comment");
  }
  expect(success.comment).toMatchObject({
    editedAt: expect.any(Date),
    version: 1
  });
  expect(success.comment.createdAt).toEqual(comment.createdAt);
  expect(success.comment.markdownCacheKey).not.toEqual(
    comment.markdownCacheKey
  );

  expect(
    await actions.editCommentAction({
      ...input,
      version: 1,
      content: success.comment.content
    })
  ).toMatchObject({
    type: "OK",
    changed: false,
    comment: { editedAt: success.comment.editedAt }
  });
  mocks.actor = null;
  expect(
    await actions.getCommentHistoryAction({
      issueId: id,
      commentId: comment.id
    })
  ).toMatchObject({
    type: "OK",
    revisions: [
      { content: "Before", format: "MARKDOWN_SNAPSHOT", editorId: author.id }
    ]
  });
});

it("rolls back comment creation and editing when their dependent inserts fail", async () => {
  const { id } = await issue();
  mocks.actor = failingActor;
  expect(
    await actions.createCommentAction({
      issueId: id,
      content: "Must roll back",
      clientRequestId: randomUUID()
    })
  ).toEqual({ type: "WRITE_ERROR" });
  expect(await readers.listIssueComments(id)).toMatchObject({ comments: [] });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();

  mocks.actor = author;
  const { comment } = await publish(id, "reject revision fixture");
  mocks.revalidatePath.mockClear();
  expect(
    await actions.editCommentAction({
      ...target(id, comment.id, 0),
      content: "Must roll back"
    })
  ).toEqual({ type: "WRITE_ERROR" });
  expect(await readers.listIssueComments(id)).toMatchObject({
    comments: [
      { content: "reject revision fixture", editedAt: null, version: 0 }
    ]
  });
  expect(
    await actions.getCommentHistoryAction({
      issueId: id,
      commentId: comment.id
    })
  ).toEqual({ type: "OK", revisions: [] });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

it("keeps audit, hidden state and restoration independent while withholding protected content", async () => {
  const { id } = await issue();
  const { comment } = await publish(id, "Original");
  await actions.editCommentAction({
    ...target(id, comment.id, 0),
    content: "Updated"
  });

  const change = (version: number) => target(id, comment.id, version);
  expect(
    await actions.hideCommentAction({ ...change(1), reason: "SPAM" })
  ).toEqual({ type: "FORBIDDEN" });
  mocks.actor = owner;
  expect(
    await actions.hideCommentAction({ ...change(1), reason: "invalid" })
  ).toMatchObject({ type: "INVALID_INPUT" });
  expect(
    await actions.hideCommentAction({ ...change(1), reason: "SPAM" })
  ).toMatchObject({ type: "OK", comment: { state: "hidden", reason: "SPAM" } });
  expect(
    await actions.getCommentHistoryAction({
      issueId: id,
      commentId: comment.id,
      moderation: true
    })
  ).toMatchObject({ type: "OK", revisions: [{ content: "Original" }] });

  mocks.actor = outsider;
  expect(
    await actions.getCommentHistoryAction({
      issueId: id,
      commentId: comment.id,
      moderation: true
    })
  ).toEqual({ type: "NOT_FOUND" });
  expect(
    await readers.listIssueComments(id, { focusId: comment.id })
  ).toMatchObject({
    type: "OK",
    comments: [],
    focus: { id: comment.id, state: "hidden", reason: "SPAM" }
  });
  expect(
    await actions.getCommentHistoryAction({
      issueId: id,
      commentId: comment.id
    })
  ).toEqual({ type: "NOT_FOUND" });

  mocks.actor = author;
  expect(await actions.deleteCommentAction(change(2))).toMatchObject({
    type: "OK",
    version: 3
  });
  expect(await actions.deleteCommentAction(change(2))).toMatchObject({
    type: "OK",
    changed: false
  });
  expect(
    await actions.getMyDeletedCommentsAction({ issueId: id })
  ).toMatchObject({
    type: "OK",
    comments: [{ id: comment.id, version: 3 }]
  });
  expect(
    await actions.getCommentHistoryAction({
      issueId: id,
      commentId: comment.id
    })
  ).toEqual({ type: "NOT_FOUND" });
  expect(await actions.restoreCommentAction(change(3))).toMatchObject({
    comment: { state: "hidden" },
    version: 4
  });

  await actions.deleteCommentAction(change(4));
  mocks.actor = owner;
  expect(await actions.unhideCommentAction(change(5))).toMatchObject({
    comment: { state: "deleted" },
    version: 6
  });
  expect(
    await actions.getMyDeletedCommentsAction({ issueId: id })
  ).toMatchObject({ comments: [] });

  mocks.actor = author;
  expect(await actions.restoreCommentAction(change(6))).toMatchObject({
    type: "OK",
    comment: { id: comment.id, state: "visible", content: "Updated" }
  });
  const audit = await testDatabase.db
    .select({
      type: issueEvents.type,
      reason: issueEvents.comment_hidden_reason
    })
    .from(issueEvents)
    .where(eq(issueEvents.comment_id, comment.id))
    .orderBy(issueEvents.id);
  expect(audit).toEqual([
    { type: "ADD_COMMENT", reason: null },
    { type: "HIDE_COMMENT", reason: "SPAM" },
    { type: "DELETE_COMMENT", reason: null },
    { type: "RESTORE_COMMENT", reason: null },
    { type: "DELETE_COMMENT", reason: null },
    { type: "UNHIDE_COMMENT", reason: "SPAM" },
    { type: "RESTORE_COMMENT", reason: null }
  ]);
});

it("pages across equal and microsecond timestamps, handles invalid cursors and reads legacy revisions", async () => {
  const { id } = await issue();
  const other = await issue();
  const inserted = await testDatabase.pool.query(
    `INSERT INTO gh_next_comments (issue_id, content, author_username, author_avatar_url, created_at)
      SELECT $1, 'legacy ' || n, 'imported-author', '/legacy.png',
        timestamp '2024-02-29 01:02:03.123456' + (CASE WHEN n = 26 THEN interval '1 microsecond' ELSE interval '0' END)
      FROM generate_series(1, 26) AS n RETURNING id`,
    [id]
  );
  const lastId = inserted.rows[25].id;
  await testDatabase.db.insert(commentRevisions).values({
    comment_id: lastId,
    updated_content: "@@ preserved GitHub diff",
    created_at: new Date("2024-03-01T00:00:00Z")
  });

  const first = await readers.listIssueComments(id);
  if (first.type !== "OK" || !first.nextCursor)
    throw new Error("Expected a second page");
  const second = await readers.listIssueComments(id, {
    cursor: first.nextCursor
  });
  expect(first.comments).toHaveLength(25);
  expect(second).toMatchObject({
    type: "OK",
    comments: [{ id: lastId }],
    nextCursor: null
  });
  expect(first.comments.map(({ id }) => id)).not.toContain(lastId);
  expect(await readers.listIssueComments(id, { cursor: "bad!" })).toEqual(
    first
  );
  expect(
    await readers.listIssueComments(other.id, { cursor: first.nextCursor })
  ).toMatchObject({ type: "OK", comments: [] });
  expect(
    await readers.listIssueComments(id, { focusId: lastId })
  ).toMatchObject({
    type: "OK",
    focus: { state: "visible", id: lastId },
    comments: [
      {
        author: { id: null, username: "imported-author" },
        editedAt: new Date("2024-03-01T00:00:00Z")
      }
    ]
  });
  expect(
    await actions.getCommentHistoryAction({ issueId: id, commentId: lastId })
  ).toMatchObject({
    type: "OK",
    revisions: [
      {
        format: "GITHUB_DIFF",
        content: "@@ preserved GitHub diff",
        editorId: null
      }
    ]
  });
});

it("checks visibility after writes in list, search, counts, sort and mention activity", async () => {
  const empty = await issue();
  const { id, number } = await issue();
  const { comment, issuePath } = await publish(
    id,
    "unique search needle fixture"
  );
  expect(issuePath).toBe(`/owner/public-fixture/issues/${number}`);
  await testDatabase.db
    .insert(reactions)
    .values({ issue_id: id, type: "PLUS_ONE" });
  await testDatabase.db.insert(issueUserMentions).values({
    issue_id: id,
    comment_id: comment.id,
    username: author.username
  });

  const find = async (query: string) =>
    (await searchIssues(parseIssueFilterTokens(query), 1, author)).issues.find(
      (row) => row.id === id
    );
  const hover = () =>
    issueModels.getSingleIssueWithLabelAndUser(
      {
        user: owner.username,
        project: "public-fixture",
        no: number
      },
      author
    );
  const textQuery = "in:comments unique search needle fixture";
  expect(await readers.listIssueComments(id)).toMatchObject({
    comments: [{ id: comment.id }]
  });
  expect(await find(textQuery)).toMatchObject({ no_of_comments: 1 });
  expect(await hover()).toMatchObject({
    mentioned_user: author.username,
    commented_user: author.username
  });

  mocks.actor = owner;
  await actions.hideCommentAction({
    ...target(id, comment.id, 0),
    reason: "SPAM"
  });
  expect(await find(textQuery)).toBeUndefined();
  expect(await find("mentions:@me")).toBeUndefined();
  expect(await find("sort:comments-desc")).toMatchObject({ no_of_comments: 0 });
  expect(await hover()).toMatchObject({
    mentioned_user: null,
    commented_user: null
  });
  expect(
    await readers.listIssueComments(id, { focusId: comment.id })
  ).toMatchObject({ comments: [], focus: { state: "hidden" } });

  await actions.unhideCommentAction(target(id, comment.id, 1));
  expect(await find("sort:comments-asc")).toMatchObject({ no_of_comments: 1 });
  expect(await find(textQuery)).toBeDefined();
  const sorted = await searchIssues(
    parseIssueFilterTokens("sort:comments-desc"),
    1,
    author
  );
  const ids = sorted.issues.map((row) => row.id);
  expect(ids.indexOf(id)).toBeLessThan(ids.indexOf(empty.id));

  mocks.actor = author;
  expect(
    await actions.deleteCommentAction(target(id, comment.id, 2))
  ).toMatchObject({ type: "OK" });
  expect(await find(textQuery)).toBeUndefined();
  expect(await find("sort:comments-asc")).toMatchObject({
    no_of_comments: 0,
    plus_one_count: 1
  });
  expect(
    await actions.restoreCommentAction(target(id, comment.id, 3))
  ).toMatchObject({ type: "OK" });
  expect(await find(textQuery)).toMatchObject({
    no_of_comments: 1,
    plus_one_count: 1
  });
});

it("returns committed data even if route revalidation fails", async () => {
  const { id } = await issue();
  mocks.revalidatePath.mockImplementationOnce(() => {
    throw new Error("Cache unavailable");
  });
  const result = await publish(id, "Committed");
  expect(result.changed).toBe(true);
  expect(mocks.revalidatePath.mock.calls).toEqual([
    [result.issuePath],
    [result.issueListPath]
  ]);
  expect(await readers.listIssueComments(id)).toMatchObject({
    comments: [{ content: "Committed" }]
  });
});

it("imports an empty discussion once and preserves existing rows and local discussions on reimport", async () => {
  const fresh = await issue();
  const local = await issue();
  const { comment } = await publish(local.id, "Local");
  const imported = postgres(testDatabase.databaseUrl, { max: 1 });
  try {
    const run = vi.fn<Parameters<typeof importEmptyIssueDiscussion>[2]>(
      async (tx) => {
        const [row] = await tx
          .insert(comments)
          .values({
            issue_id: fresh.id,
            content: "Imported",
            author_username: "legacy",
            author_avatar_url: "/fixture.png"
          })
          .returning();
        await tx
          .insert(commentRevisions)
          .values({ comment_id: row.id, updated_content: "GitHub diff" });
        await tx
          .insert(reactions)
          .values({ comment_id: row.id, type: "HEART" });
      }
    );
    const db = drizzleImporter(imported);
    expect(await importEmptyIssueDiscussion(db, fresh.id, run)).toBe(true);
    const [before] = await testDatabase.db
      .select()
      .from(comments)
      .where(eq(comments.issue_id, fresh.id));
    expect(await importEmptyIssueDiscussion(db, fresh.id, run)).toBe(false);
    expect(await importEmptyIssueDiscussion(db, local.id, run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    const [after] = await testDatabase.db
      .select()
      .from(comments)
      .where(and(eq(comments.issue_id, fresh.id), eq(comments.id, before.id)));
    expect(after.content).toBe("Imported");
    expect(
      await testDatabase.db
        .select()
        .from(commentRevisions)
        .where(eq(commentRevisions.comment_id, before.id))
    ).toHaveLength(1);
    expect(
      await testDatabase.db
        .select()
        .from(reactions)
        .where(eq(reactions.comment_id, before.id))
    ).toHaveLength(1);
    expect(await readers.listIssueComments(local.id)).toMatchObject({
      comments: [{ id: comment.id, content: "Local" }]
    });
    const { rows } = await testDatabase.pool.query(
      "SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trigger_refresh_%'"
    );
    expect(rows.map((row) => row.tgname)).toEqual([
      "trigger_refresh_reaction_count"
    ]);
  } finally {
    await imported.end();
  }
});
