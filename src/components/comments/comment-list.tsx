import "server-only";
import Link from "next/link";
import { getAuthedUser } from "~/actions/auth.action";
import { renderCommentPreviewAction } from "~/actions/comment-render.action";
import { Button } from "~/components/button";
import { Markdown } from "~/components/markdown/markdown";
import { db } from "~/lib/server/db/index.server";
import { commentHideReasonLabels } from "~/lib/shared/comment-options";
import { getIssueCommentContext } from "~/models/comments/access";
import { commentPermissions } from "~/models/comments/permissions";
import {
  listHiddenComments,
  listIssueComments,
  listMyDeletedComments
} from "~/models/comments/read";
import { issueCommentId } from "~/models/comments/validation";
import { CommentDate } from "./comment-date";
import { NewComment } from "./comment-form";
import { commentPermalink } from "./comment-helpers";
import { CommentHistory } from "./comment-history";
import { CommentItem, FocusComment } from "./comment-item";
import { CommentVisibilityActions } from "./comment-visibility-actions";

const topAnchor = "#issue-comments-heading";

export async function CommentList({
  issueId,
  searchParams = {}
}: {
  issueId: number;
  searchParams?: Partial<
    Record<"cursor" | "comment" | "deleted" | "hidden", string>
  >;
}) {
  try {
    return await Discussion({ issueId, searchParams });
  } catch (error) {
    console.error(
      "Issue comments could not be read",
      error instanceof Error ? error.name : undefined
    );
    return (
      <p role="alert" className="px-5">
        Could not load comments. Reload the page to try again.
      </p>
    );
  }
}

async function Discussion({
  issueId,
  searchParams
}: {
  issueId: number;
  searchParams: Partial<
    Record<"cursor" | "comment" | "deleted" | "hidden", string>
  >;
}) {
  const [context, viewer] = await Promise.all([
    getIssueCommentContext(db, issueId),
    getAuthedUser()
  ]);
  if (!context)
    return (
      <p role="alert" className="px-5">
        Discussion unavailable.
      </p>
    );

  const viewerId = viewer?.id;
  const permissions = commentPermissions(context, viewerId);
  const repository = `${context.owner}/${context.repository}` as const;
  const issuePath = `/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repository)}/issues/${context.number}`;
  const preview = renderCommentPreviewAction.bind(null, issueId);
  const parsedFocus =
    typeof searchParams.comment === "string" &&
    /^\d+$/.test(searchParams.comment)
      ? issueCommentId.safeParse(Number(searchParams.comment))
      : undefined;
  const focusId = parsedFocus?.success ? parsedFocus.data : undefined;
  const cursor =
    typeof searchParams.cursor === "string" ? searchParams.cursor : undefined;
  const deletedCursor =
    typeof searchParams.deleted === "string" ? searchParams.deleted : undefined;
  const hiddenCursor =
    typeof searchParams.hidden === "string" ? searchParams.hidden : undefined;
  const [requestedPage, deleted, hidden] = await Promise.all([
    listIssueComments(issueId, { cursor, focusId, viewerId }),
    viewerId === undefined
      ? null
      : listMyDeletedComments(issueId, viewerId, deletedCursor),
    viewerId === undefined || !permissions.canReadModeration
      ? null
      : listHiddenComments(issueId, viewerId, hiddenCursor)
  ]);
  const unavailable =
    searchParams.comment !== undefined &&
    (focusId === undefined || requestedPage.type !== "OK");
  const page =
    requestedPage.type === "OK"
      ? requestedPage
      : await listIssueComments(issueId);
  if (page.type !== "OK")
    return (
      <p role="alert" className="px-5">
        Discussion unavailable.
      </p>
    );

  const { focus, focusedHidden } = page;

  return (
    <section
      aria-labelledby="issue-comments-heading"
      className="min-w-0 space-y-4 px-3 pb-8 sm:px-5"
    >
      <h2
        id="issue-comments-heading"
        tabIndex={-1}
        className="scroll-mt-24 text-xl font-semibold"
      >
        Discussion
      </h2>
      {focus && <FocusComment id={focus.id} />}
      {unavailable && <p role="status">Comment unavailable.</p>}
      {focus && focus.state !== "visible" && (
        <article
          id={`issuecomment-${focus.id}`}
          tabIndex={-1}
          aria-label="Unavailable comment"
          className="scroll-mt-24 space-y-3 rounded-md border border-neutral p-3"
        >
          {focus.state === "deleted" ? (
            <p>This comment was deleted.</p>
          ) : (
            <>
              <p>
                This comment is hidden
                {focus.reason
                  ? ` · ${commentHideReasonLabels[focus.reason]}`
                  : ""}
                .
              </p>
              {focusedHidden?.permissions.canReadModeration && (
                <CommentHistory
                  issueId={issueId}
                  commentId={focus.id}
                  version={focusedHidden.version}
                  moderation
                >
                  View hidden comment and history
                </CommentHistory>
              )}
              {focusedHidden && (
                <CommentVisibilityActions
                  issueId={issueId}
                  commentId={focus.id}
                  version={focusedHidden.version}
                  canDelete={focusedHidden.permissions.canManageOwn}
                  canUnhide={focusedHidden.permissions.canModerate}
                />
              )}
            </>
          )}
        </article>
      )}

      {page.comments.length === 0 && (
        <p className="text-grey">No comments on this page.</p>
      )}
      {page.comments.length > 0 && (
        <ol aria-label="Issue comments" className="space-y-3">
          {page.comments.map((comment) => (
            <li key={comment.id} className="min-w-0">
              <CommentItem
                issueId={issueId}
                issuePath={issuePath}
                commentId={comment.id}
                version={comment.version}
                author={comment.author}
                createdAt={comment.createdAt}
                editedAt={comment.editedAt}
                canModerate={permissions.canModerate}
                editor={
                  viewerId !== undefined &&
                  commentPermissions(context, viewerId, comment.author.id)
                    .canManageOwn
                    ? { userId: viewerId, content: comment.content, preview }
                    : undefined
                }
              >
                <Markdown
                  content={comment.content}
                  repository={repository}
                  cacheKey={comment.markdownCacheKey}
                />
              </CommentItem>
            </li>
          ))}
        </ol>
      )}
      <Pagination
        issuePath={issuePath}
        parameter="cursor"
        start={!!(cursor || searchParams.comment)}
        next={page.nextCursor}
        label="Comments"
      />

      {deleted?.type === "OK" && (
        <details
          open={deletedCursor !== undefined ? true : undefined}
          className="space-y-3 rounded-md border border-neutral p-3"
        >
          <summary className="cursor-pointer rounded font-semibold focus-visible:outline-accent">
            My deleted comments
          </summary>
          {deleted.comments.length === 0 && <p>No deleted comments.</p>}
          <ul className="space-y-3">
            {deleted.comments.map((comment) => (
              <li
                key={comment.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div className="text-sm">
                  <Link
                    href={commentPermalink(issuePath, comment.id)}
                    prefetch={false}
                    className="text-accent underline"
                  >
                    Comment #{comment.id}
                  </Link>
                  {comment.deletedAt && (
                    <>
                      {" "}
                      · Deleted <CommentDate date={comment.deletedAt} />
                    </>
                  )}
                </div>
                {!context.archived && (
                  <CommentVisibilityActions
                    issueId={issueId}
                    commentId={comment.id}
                    version={comment.version}
                    canRestore
                  />
                )}
              </li>
            ))}
          </ul>
          <Pagination
            issuePath={issuePath}
            parameter="deleted"
            start={!!deletedCursor}
            next={deleted.nextCursor}
            label="Deleted comments"
          />
        </details>
      )}

      {hidden?.type === "OK" && (
        <details
          open={hiddenCursor !== undefined ? true : undefined}
          className="space-y-3 rounded-md border border-neutral p-3"
        >
          <summary className="cursor-pointer rounded font-semibold focus-visible:outline-accent">
            Hidden comments
          </summary>
          {hidden.comments.length === 0 && <p>No hidden comments.</p>}
          <ul className="space-y-3">
            {hidden.comments.map((comment) => (
              <li
                key={comment.id}
                className="space-y-2 border-t border-neutral pt-2"
              >
                <p className="text-sm">
                  <Link
                    href={commentPermalink(issuePath, comment.id)}
                    prefetch={false}
                    className="text-accent underline"
                  >
                    Comment #{comment.id}
                  </Link>
                  {" · "}
                  <bdi>{comment.authorUsername}</bdi>
                  {comment.reason && (
                    <> · {commentHideReasonLabels[comment.reason]}</>
                  )}
                  {comment.deletedAt && " · Deleted"}
                </p>
                <CommentHistory
                  issueId={issueId}
                  commentId={comment.id}
                  version={comment.version}
                  moderation
                >
                  View hidden comment and history
                </CommentHistory>
                {permissions.canModerate && (
                  <CommentVisibilityActions
                    issueId={issueId}
                    commentId={comment.id}
                    version={comment.version}
                    canUnhide
                  />
                )}
              </li>
            ))}
          </ul>
          <Pagination
            issuePath={issuePath}
            parameter="hidden"
            start={!!hiddenCursor}
            next={hidden.nextCursor}
            label="Hidden comments"
          />
        </details>
      )}

      {permissions.canPublish && viewer ? (
        <NewComment
          key={viewer.id}
          issueId={issueId}
          userId={viewer.id}
          username={viewer.username}
          preview={preview}
        />
      ) : (
        <p className="text-sm text-grey">
          {context.archived ? (
            "This repository is archived. Discussion is read-only."
          ) : context.locked ? (
            "This discussion is locked."
          ) : (
            <>
              <Link
                href={`/login?${new URLSearchParams({ nextUrl: issuePath })}`}
                className="text-accent underline"
              >
                Sign in
              </Link>{" "}
              to leave a comment.
            </>
          )}
        </p>
      )}
    </section>
  );
}

function Pagination({
  issuePath,
  parameter,
  start,
  next,
  label
}: {
  issuePath: string;
  parameter: "cursor" | "deleted" | "hidden";
  start: boolean;
  next: string | null;
  label: string;
}) {
  if (!start && !next) return null;
  return (
    <nav aria-label={label + " pagination"} className="flex flex-wrap gap-2">
      {start && (
        <Button
          variant="subtle"
          prefetch={false}
          href={
            issuePath +
            (parameter === "cursor" ? "" : `?${parameter}=`) +
            topAnchor
          }
        >
          First page
        </Button>
      )}
      {next && (
        <Button
          variant="subtle"
          prefetch={false}
          href={`${issuePath}?${parameter}=${encodeURIComponent(next)}${topAnchor}`}
        >
          Next page
        </Button>
      )}
    </nav>
  );
}
