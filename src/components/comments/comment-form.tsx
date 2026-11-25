"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createCommentAction } from "~/actions/comment.action";
import { Button } from "~/components/button";
import { MarkdownEditor } from "~/components/markdown-editor/markdown-editor";
import { COMMENT_MAX_LENGTH } from "~/lib/shared/comment-options";
import {
  commentActionError,
  commentPermalink,
  getCommentRequest
} from "./comment-helpers";
import type { FormEvent } from "react";
import type { MarkdownEditorProps } from "~/components/markdown-editor/markdown-editor";

export type CommentPreview = MarkdownEditorProps["renderMarkdownAction"];
type Request = { id: string; content: string };
type Draft = { content: string; request?: Request };
type SaveError = { message: string; field?: boolean; resetRequest?: boolean };

function readDraft(key: string): Draft | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value && typeof value.content === "string") return value;
  } catch {
    // The editor still works if session storage is unavailable.
  }
}

function storeDraft(key: string, draft?: Draft) {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    // The current editor retains the draft in memory.
  }
}

export function CommentForm({
  draftKey,
  initialContent = "",
  preview,
  onSave,
  onPending,
  onCancel
}: {
  draftKey: string;
  initialContent?: string;
  preview: CommentPreview;
  onSave: (content: string, requestId?: string) => Promise<SaveError | void>;
  onPending: (content: string | null) => void;
  onCancel?: () => void;
}) {
  const isEditing = !!onCancel;
  const form = useRef<HTMLFormElement>(null);
  const request = useRef<Request>();
  const [initialDraft, setInitialDraft] = useState<string | undefined>();
  const [editorKey, setEditorKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SaveError>();

  useEffect(() => {
    const draft = readDraft(draftKey);
    request.current = draft?.request;
    if (draft) {
      setInitialDraft(draft.content);
      setEditorKey((previous) => previous + 1);
    }
    if (isEditing) {
      const frame = requestAnimationFrame(() =>
        form.current?.querySelector("textarea")?.focus()
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [draftKey, isEditing]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const content = String(
      new FormData(event.currentTarget).get("content") ?? ""
    );
    storeDraft(draftKey, { content, request: request.current });
    if (
      !content.trim() ||
      content.length > COMMENT_MAX_LENGTH ||
      content.includes("\0")
    ) {
      setError({
        message: `Enter a non-empty comment of at most ${COMMENT_MAX_LENGTH.toLocaleString("en")} characters without null characters.`,
        field: true
      });
      return;
    }

    if (!isEditing) {
      request.current = getCommentRequest(request.current, content, () =>
        crypto.randomUUID()
      );
      storeDraft(draftKey, { content, request: request.current });
    }

    setError(undefined);
    setPending(true);
    onPending(content);
    try {
      const failure = await onSave(content, request.current?.id);
      if (failure) {
        setError(failure);
        if (failure.resetRequest) {
          request.current = undefined;
          storeDraft(draftKey, { content });
        }
        return;
      }

      request.current = undefined;
      storeDraft(draftKey);
      setInitialDraft(undefined);
      setEditorKey((previous) => previous + 1);
    } catch {
      setError({
        message:
          "Could not confirm the save. Your draft is still here. Try again."
      });
    } finally {
      setPending(false);
      onPending(null);
    }
  }

  return (
    <form ref={form} onSubmit={submit} noValidate className="min-w-0 space-y-3">
      <MarkdownEditor
        key={editorKey}
        label={isEditing ? "Edit comment" : "Leave a comment"}
        name="content"
        rows={isEditing ? 5 : 7}
        defaultValue={initialDraft ?? initialContent}
        renderMarkdownAction={preview}
        tabToIndent={false}
        readOnly={pending}
        required
        maxLength={COMMENT_MAX_LENGTH}
        validationStatus={error?.field ? "error" : undefined}
        validationText={error?.message}
        onChange={(event) =>
          storeDraft(draftKey, {
            content: event.currentTarget.value,
            request: request.current
          })
        }
      />
      {error && !error.field && (
        <p role="alert" className="text-sm text-danger">
          {error.message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="subtle"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {isEditing ? "Save changes" : "Comment"}
        </Button>
      </div>
    </form>
  );
}

export function NewComment({
  issueId,
  userId,
  username,
  preview
}: {
  issueId: number;
  userId: number;
  username: string;
  preview: CommentPreview;
}) {
  const router = useRouter();
  const [pendingBody, setPendingBody] = useState<string | null>(null);
  const [postedHref, setPostedHref] = useState<string>();

  async function publish(content: string, requestId?: string) {
    setPostedHref(undefined);
    const result = await createCommentAction({
      issueId,
      content,
      clientRequestId: requestId
    });
    if (result.type === "INVALID_INPUT") {
      return {
        message:
          result.errors.fieldErrors.content?.[0] ??
          "Check the comment and try again.",
        field: true
      };
    }
    if (result.type !== "OK") {
      return {
        message: commentActionError(result.type),
        resetRequest: result.type === "REQUEST_CONFLICT"
      };
    }

    const href = commentPermalink(result.issuePath, result.comment.id);
    setPostedHref(href);
    router.push(href);
  }

  return (
    <div className="min-w-0 space-y-3">
      {pendingBody !== null && (
        <div
          role="status"
          className="min-w-0 rounded-md border border-neutral p-3"
        >
          <p className="font-semibold">{username} · Posting comment…</p>
          <p className="whitespace-pre-wrap break-words">{pendingBody}</p>
        </div>
      )}
      {postedHref && (
        <p role="status">
          Comment posted.{" "}
          <a className="text-accent underline" href={postedHref}>
            Open comment
          </a>
        </p>
      )}
      <CommentForm
        draftKey={`issue-comment:${userId}:${issueId}:new`}
        preview={preview}
        onSave={publish}
        onPending={setPendingBody}
      />
    </div>
  );
}
