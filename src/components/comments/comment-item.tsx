"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { editCommentAction } from "~/actions/comment.action";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { CommentDate } from "./comment-date";
import { CommentForm } from "./comment-form";
import { CommentHistory } from "./comment-history";
import { CommentVisibilityActions } from "./comment-visibility-actions";
import { commentActionError, commentPermalink } from "./comment-helpers";
import type { ReactNode } from "react";
import type { CommentPreview } from "./comment-form";

export function CommentItem({
  issueId,
  issuePath,
  commentId,
  version,
  author,
  createdAt,
  editedAt,
  canModerate,
  editor,
  children
}: {
  issueId: number;
  issuePath: string;
  commentId: number;
  version: number;
  author: { username: string; avatarUrl: string };
  createdAt: Date;
  editedAt: Date | null;
  canModerate: boolean;
  editor?: { userId: number; content: string; preview: CommentPreview };
  children: ReactNode;
}) {
  const router = useRouter();
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [pendingBody, setPendingBody] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    version: number;
    content: string;
  }>();
  const editButton = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const restoreFocus = useRef(false);
  const editing = baseVersion !== null;
  const confirmedBody =
    confirmed && confirmed.version > version ? confirmed.content : null;

  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  function closeEditor() {
    restoreFocus.current = true;
    setBaseVersion(null);
  }

  async function save(content: string) {
    try {
      const result = await editCommentAction({
        issueId,
        commentId,
        content,
        version: baseVersion
      });
      if (result.type === "OK") {
        if (result.comment.state === "visible") setConfirmed(result.comment);
        closeEditor();
        return;
      }
      if (result.type === "INVALID_INPUT") {
        return {
          message:
            result.errors.fieldErrors.content?.[0] ??
            "Check the comment and try again.",
          field: true
        };
      }
      if (result.type === "VERSION_CONFLICT") {
        setBaseVersion(result.version);
        router.refresh();
      }
      return { message: commentActionError(result.type) };
    } catch (error) {
      router.refresh();
      throw error;
    }
  }

  return (
    <article
      id={`issuecomment-${commentId}`}
      tabIndex={-1}
      aria-label={`Comment by ${author.username}`}
      className="min-w-0 scroll-mt-24 rounded-md border border-neutral focus-visible:outline-accent"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-t-md border-b border-neutral bg-subtle px-3 py-2 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Avatar
            username={author.username}
            src={author.avatarUrl}
            size="small"
          />
          <bdi className="break-all font-semibold">{author.username}</bdi>
          <a
            href={commentPermalink(issuePath, commentId)}
            aria-label={`Permalink to comment ${commentId}`}
            className="rounded underline focus-visible:outline-accent"
          >
            <CommentDate date={createdAt} />
          </a>
        </div>
        {editor && !editing && (
          <Button
            ref={editButton}
            type="button"
            variant="subtle"
            onClick={() => setBaseVersion(version)}
          >
            Edit
          </Button>
        )}
      </header>
      <div className="min-w-0 space-y-3 p-3">
        {pendingBody !== null || confirmedBody !== null ? (
          <div role={pendingBody !== null ? "status" : undefined}>
            {pendingBody !== null && (
              <p className="text-sm text-grey">Saving edits…</p>
            )}
            <p className="whitespace-pre-wrap break-words">
              {pendingBody ?? confirmedBody}
            </p>
          </div>
        ) : (
          children
        )}
        {editedAt && (
          <CommentHistory
            issueId={issueId}
            commentId={commentId}
            version={version}
          >
            Edited <CommentDate date={editedAt} />
          </CommentHistory>
        )}
        {editor && editing && (
          <CommentForm
            draftKey={`issue-comment:${editor.userId}:${issueId}:${commentId}`}
            initialContent={editor.content}
            preview={editor.preview}
            onSave={save}
            onPending={setPendingBody}
            onCancel={closeEditor}
          />
        )}
        {!editing && (editor || canModerate) && (
          <CommentVisibilityActions
            issueId={issueId}
            commentId={commentId}
            version={version}
            canDelete={!!editor}
            canHide={canModerate}
          />
        )}
      </div>
    </article>
  );
}

export function FocusComment({ id }: { id: number }) {
  useEffect(() => {
    const target = `issuecomment-${id}`;
    if (location.hash !== `#${target}`) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(target);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [id]);

  return null;
}
