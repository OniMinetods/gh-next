"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCommentAction,
  hideCommentAction,
  restoreCommentAction,
  unhideCommentAction
} from "~/actions/comment.action";
import { Button } from "~/components/button";
import {
  commentHideReasonLabels,
  commentHideReasons
} from "~/lib/shared/comment-options";
import { commentActionError } from "./comment-helpers";
import type { FormEvent } from "react";

const actions = {
  delete: deleteCommentAction,
  restore: restoreCommentAction,
  hide: hideCommentAction,
  unhide: unhideCommentAction
};

export function CommentVisibilityActions({
  issueId,
  commentId,
  version,
  canDelete,
  canRestore,
  canHide,
  canUnhide
}: {
  issueId: number;
  commentId: number;
  version: number;
  canDelete?: boolean;
  canRestore?: boolean;
  canHide?: boolean;
  canUnhide?: boolean;
}) {
  const router = useRouter();
  const reasonId = useId();
  const [pending, setPending] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [error, setError] = useState("");

  async function change(
    operation: keyof typeof actions,
    reason?: FormDataEntryValue | null
  ) {
    setPending(true);
    setError("");
    try {
      const result = await actions[operation]({
        issueId,
        commentId,
        version,
        ...(operation === "hide" && { reason })
      });
      if (result.type === "OK") {
        setShowReasons(false);
        if (!result.changed) router.refresh();
      } else {
        setError(
          result.type === "INVALID_INPUT"
            ? "Choose a reason for hiding this comment."
            : commentActionError(result.type)
        );
        if (result.type === "VERSION_CONFLICT") router.refresh();
      }
    } catch {
      setError("Could not confirm the change. Try again.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function hide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void change("hide", new FormData(event.currentTarget).get("reason"));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canDelete && (
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => change("delete")}
          >
            Delete
          </Button>
        )}
        {canRestore && (
          <Button
            type="button"
            variant="subtle"
            disabled={pending}
            onClick={() => change("restore")}
          >
            Restore
          </Button>
        )}
        {canHide && (
          <Button
            type="button"
            variant="subtle"
            disabled={pending}
            aria-expanded={showReasons}
            aria-controls={reasonId}
            onClick={() => setShowReasons(!showReasons)}
          >
            Hide
          </Button>
        )}
        {canUnhide && (
          <Button
            type="button"
            variant="subtle"
            disabled={pending}
            onClick={() => change("unhide")}
          >
            Unhide
          </Button>
        )}
      </div>
      {canHide && (
        <form id={reasonId} hidden={!showReasons} onSubmit={hide}>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-0 gap-1 text-sm">
              Reason for hiding
              <select
                required
                name="reason"
                defaultValue=""
                disabled={pending}
                className="rounded-md border border-neutral bg-backdrop px-3 py-1.5"
              >
                <option value="" disabled>
                  Select a reason
                </option>
                {commentHideReasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {commentHideReasonLabels[reason]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="subtle" disabled={pending}>
              Hide comment
            </Button>
          </div>
        </form>
      )}
      {pending && <p role="status">Saving comment status…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
