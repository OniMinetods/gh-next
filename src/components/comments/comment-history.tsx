"use client";

import { useEffect, useId, useState } from "react";
import { getRenderedCommentHistoryAction } from "~/actions/comment-render.action";
import { Button } from "~/components/button";
import type { ReactNode } from "react";

export function CommentHistory({
  issueId,
  commentId,
  version,
  moderation = false,
  children
}: {
  issueId: number;
  commentId: number;
  version: number;
  moderation?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ReactNode>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;

    setHistory(null);
    getRenderedCommentHistoryAction({ issueId, commentId, moderation })
      .then((result) => {
        if (active) {
          setHistory(
            result.type === "OK" ? (
              result.history
            ) : (
              <p role="alert">This comment history is unavailable.</p>
            )
          );
        }
      })
      .catch(() => {
        if (active) {
          setHistory(
            <p role="alert">
              Could not load comment history. Close and reopen to retry.
            </p>
          );
        }
      });

    return () => {
      active = false;
    };
  }, [open, issueId, commentId, moderation, version]);

  return (
    <div className="min-w-0 max-w-full">
      <Button
        type="button"
        variant="neutral"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setHistory(null);
          setOpen(!open);
        }}
      >
        {children}
      </Button>
      <div id={id} hidden={!open} className="min-w-0">
        {open && (history ?? <p role="status">Loading comment history…</p>)}
      </div>
    </div>
  );
}
