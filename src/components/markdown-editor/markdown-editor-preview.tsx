"use client";
import * as React from "react";
// components
import { ErrorBoundary } from "react-error-boundary";
import { Skeleton } from "~/components/skeleton";

export type MarkdownEditorPreviewProps = {
  renderedMarkdown: Promise<React.JSX.Element>;
};

export function MarkdownEditorPreview(props: MarkdownEditorPreviewProps) {
  return (
    <>
      <ErrorBoundary
        fallback={<p role="alert">Could not render preview. Switch to Write and try again.</p>}
      >
        <React.Suspense
          fallback={
            <div className="flex flex-col gap-4 sm:rounded-b-md w-full">
              <span className="sr-only">loading preview...</span>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="min-h-[4rem] flex-1 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          }
        >
          {React.use(props.renderedMarkdown)}
        </React.Suspense>
      </ErrorBoundary>
    </>
  );
}
