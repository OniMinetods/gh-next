"use server";

import { getAuthedUser } from "./auth.action";
import { getCommentHistory } from "~/models/comments/read";
import { CommentDate } from "~/components/comments/comment-date";
import { Markdown } from "~/components/markdown/markdown";
import { db } from "~/lib/server/db/index.server";
import { getIssueCommentContext } from "~/models/comments/access";
import {
  commentContent,
  commentHistoryInput,
  issueCommentId
} from "~/models/comments/validation";

export async function renderCommentPreviewAction(
  issueId: number,
  content: string
) {
  if (!issueCommentId.safeParse(issueId).success)
    return <p role="alert">Comment preview is unavailable.</p>;
  const body = commentContent.safeParse(content);
  const user = await getAuthedUser();
  if (!user) return <p role="alert">Sign in to preview a comment.</p>;
  if (!body.success) return <p role="alert">{body.error.issues[0].message}</p>;

  const context = await getIssueCommentContext(db, issueId);
  if (!context || context.archived) {
    return <p role="alert">Comment preview is unavailable.</p>;
  }

  return (
    <Markdown
      content={body.data}
      repository={`${context.owner}/${context.repository}`}
    />
  );
}

export async function getRenderedCommentHistoryAction(input: unknown) {
  const parsed = commentHistoryInput.safeParse(input);
  if (!parsed.success) return { type: "INVALID_INPUT" as const };
  const { issueId, commentId, moderation } = parsed.data;
  const viewer = await getAuthedUser();
  const result = await getCommentHistory(
    issueId,
    commentId,
    viewer?.id,
    moderation
  );
  if (result.type !== "OK") return result;

  return {
    type: "OK" as const,
    history: (
      <section
        aria-label="Comment history"
        className="space-y-3 rounded-md border border-neutral p-3"
      >
        {result.moderatedContent !== undefined && (
          <div className="min-w-0 space-y-2">
            <h3 className="font-semibold">Current hidden text</h3>
            <Markdown
              content={result.moderatedContent}
              repository={result.repository}
            />
          </div>
        )}
        {result.revisions.length === 0 && <p>No previous versions.</p>}
        {result.revisions.length > 0 && (
          <ol className="space-y-3">
            {result.revisions.map((revision) => (
              <li
                key={revision.id}
                className="min-w-0 space-y-2 border-t border-neutral pt-2"
              >
                <h3 className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                  <span>
                    {revision.format === "GITHUB_DIFF"
                      ? "GitHub diff"
                      : "Previous version"}
                  </span>
                  <CommentDate date={revision.createdAt} />
                </h3>
                {revision.format === "GITHUB_DIFF" ? (
                  <pre className="max-w-full overflow-auto rounded-md bg-neutral p-3 text-sm">
                    <code>{revision.content}</code>
                  </pre>
                ) : (
                  <Markdown
                    content={revision.content}
                    repository={result.repository}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    )
  };
}
