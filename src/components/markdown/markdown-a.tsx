import "server-only";
// components
import {
  IssueOpenedIcon,
  IssueClosedIcon,
  SkipIcon
} from "@primer/octicons-react";
import { HoverCard } from "~/components/hovercard/hovercard";
import { MarkdownTitle } from "~/components/markdown/markdown-title";
import { UserHoverCardContents } from "~/components/hovercard/user-hovercard-contents";
import { Avatar } from "~/components/avatar";
import { IssueHoverCardLink } from "~/components/hovercard/issue-hovercard-link";
import Link from "next/link";

import { env } from "~/env";
import { clsx, getExcerpt, isValidURL } from "~/lib/shared/utils.shared";
import type { BuildUrlValues } from "remark-github";
import type { IssueQueryResult } from "~/models/issues";
import type { UserQueryResult } from "~/models/user";

export type Reference = Exclude<BuildUrlValues, { type: "compare" }>;

export type ResolvedReferences = {
  issues: Map<string, IssueQueryResult>;
  mentions: Map<string, UserQueryResult>;
};

export function issueReferenceKey(
  owner: string,
  repository: string,
  number: number
) {
  return `${owner}/${repository}/${number}`.toLowerCase();
}

type MarkdownAProps = {
  resolvedReferences: ResolvedReferences;
  currentRepository: string;
  reference?: Reference;
} & React.ComponentProps<"a">;

export function MarkdownA({
  resolvedReferences,
  currentRepository,
  reference: referenceFound,
  ...props
}: MarkdownAProps) {
  if (!referenceFound) {
    if (!props.href) return <span>{props.children}</span>;
    let external;
    try {
      const base = new URL(env.NEXT_PUBLIC_VERCEL_URL);
      external = new URL(props.href, base).origin !== base.origin;
    } catch {
      return <span>{props.children}</span>;
    }

    const children =
      typeof props.children === "string" && isValidURL(props.children)
        ? getExcerpt(props.children, 150)
        : props.children;
    return (
      <a
        {...props}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="underline inline-flex gap-1 items-baseline text-accent break-all"
      >
        {children}
      </a>
    );
  }

  if (referenceFound.type === "issue") {
    const issueFound = resolvedReferences.issues.get(
      issueReferenceKey(
        referenceFound.user,
        referenceFound.project,
        Number(referenceFound.no)
      )
    );
    const repository = `${referenceFound.user}/${referenceFound.project}`;

    if (!issueFound) {
      return <span className="break-all">{props.children}</span>;
    }

    return (
      <IssueHoverCardLink
        href={`/${encodeURIComponent(issueFound.repository_owner)}/${encodeURIComponent(issueFound.repository_name)}/issues/${issueFound.number}`}
        user={issueFound.repository_owner}
        repository={issueFound.repository_name}
        no={Number(referenceFound.no)}
        className={clsx(
          "underline inline-flex gap-1 items-baseline text-accent",
          "ring-accent rounded-md focus:outline-none focus:ring-2"
        )}
      >
        {issueFound.status === "OPEN" && (
          <IssueOpenedIcon className="h-3.5 w-3.5 flex-shrink-0 text-success relative top-0.5" />
        )}
        {issueFound.status === "CLOSED" && (
          <IssueClosedIcon className="h-3.5 w-3.5 flex-shrink-0 text-done relative top-0.5" />
        )}
        {issueFound.status === "NOT_PLANNED" && (
          <SkipIcon className="h-3.5 w-3.5 flex-shrink-0 text-grey relative top-0.5" />
        )}
        <span className="break-all">
          <MarkdownTitle title={issueFound.title} className="font-semibold" />
          &nbsp;
          <span className="text-grey font-normal">
            {repository.toLowerCase() === currentRepository.toLowerCase()
              ? ""
              : repository}
            #{referenceFound.no}
          </span>
        </span>
      </IssueHoverCardLink>
    );
  }

  if (referenceFound.type === "mention") {
    const userFound = resolvedReferences.mentions.get(
      referenceFound.user.toLowerCase()
    );

    if (!userFound) {
      return <span>{props.children}</span>;
    }
    return (
      <HoverCard
        side="top"
        align="start"
        delayInMs={700}
        content={
          <UserHoverCardContents
            avatar_url={userFound.avatar_url}
            bio={userFound.bio}
            location={userFound.location}
            name={userFound.name}
            username={userFound.username}
          />
        }
      >
        <Link
          href={`/${userFound.username}`}
          className={clsx(
            "inline-flex gap-1 font-bold underline items-center",
            "ring-accent rounded-md focus:outline-none focus:ring-2",
            `mention-${userFound.username}`
          )}
        >
          <Avatar
            src={userFound.avatar_url}
            username={userFound.username}
            size="x-small"
          />
          <span>@{userFound.username}</span>
        </Link>
      </HoverCard>
    );
  }

  if (referenceFound.type === "commit") {
    // TODO : handle commit mentions
    return <span>{props.children}</span>;
  }

  return <span>{props.children}</span>;
}
