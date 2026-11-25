import "server-only";
import { createElement, Fragment } from "react";
import { Code } from "bright";
import { preload } from "@code-hike/lighter";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import {
  DeviceCameraVideoIcon,
  TriangleDownIcon
} from "@primer/octicons-react";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { MarkdownA, issueReferenceKey } from "./markdown-a";
import { MarkdownH } from "./markdown-h";
import { parseMarkdown } from "./markdown-content";
import { clsx } from "~/lib/shared/utils.shared";
import { CacheKeys } from "~/lib/shared/cache-keys.shared";
import githubDark from "~/lib/server/themes/github-dark.json";
import githubLight from "~/lib/server/themes/github-light.json";
import { getMultipleIssuesPerRepositories } from "~/models/issues";
import {
  GITHUB_AUTHOR_USERNAME,
  GITHUB_REPOSITORY_NAME
} from "~/lib/shared/constants";
import { getMultipleUserByUsername } from "~/models/user";
import { ttlCache } from "~/lib/server/rsc-utils.server";
import type { CacheId } from "~/lib/server/rsc-utils.server";
import type { Components, Jsx } from "hast-util-to-jsx-runtime";
import type { ElementType } from "react";
import type { Reference, ResolvedReferences } from "./markdown-a";

const jsx: Jsx = (type, props, key) =>
  createElement(type as ElementType, { ...props, key });

export type MarkdownProps = {
  content: string;
  linkHeaders?: boolean;
  className?: string;
  editableCheckboxes?: boolean;
  repository?: `${string}/${string}`;
  cacheKey?: CacheId;
  cacheTTL?: number;
};

export async function Markdown({
  content,
  className,
  linkHeaders = false,
  editableCheckboxes = false,
  repository:
    currentRepository = `${GITHUB_AUTHOR_USERNAME}/${GITHUB_REPOSITORY_NAME}`,
  cacheKey,
  cacheTTL
}: MarkdownProps) {
  const { tree, references, localIssueLinks } = await getMarkdownTree(
    content,
    currentRepository,
    cacheKey,
    cacheTTL
  );
  const resolvedReferences = await resolveReferences([
    ...Object.values(references),
    ...Object.values(localIssueLinks)
  ]);

  return (
    <article
      className={clsx(
        "break-words leading-normal text-sm max-w-full w-full",
        className
      )}
    >
      {toJsxRuntime(tree, {
        Fragment,
        jsx,
        jsxs: jsx,
        components: getComponents({
          linkHeaders,
          editableCheckboxes,
          references,
          localIssueLinks,
          resolvedReferences,
          currentRepository
        })
      })}
    </article>
  );
}

async function getMarkdownTree(
  content: string,
  repository: string,
  cacheKey?: CacheId,
  cacheTTL?: number
) {
  if (cacheKey) {
    const cached = ttlCache(parseMarkdown, {
      id: CacheKeys.markdownTree(cacheKey),
      ttl: cacheTTL,
      forceDev: process.env.GH_NEXT_E2E === "1"
    });
    try {
      return await cached(content, repository);
    } catch (error) {
      console.error(
        "Markdown cache unavailable",
        error instanceof Error ? error.name : undefined
      );
    }
  }
  return parseMarkdown(content, repository);
}

async function resolveReferences(
  references: Reference[]
): Promise<ResolvedReferences> {
  const issueReferences = references.filter(
    (reference): reference is Extract<Reference, { type: "issue" }> =>
      reference.type === "issue"
  );
  const userMentions = references
    .filter((reference) => reference.type === "mention")
    .map((reference) => reference.user);

  const [issues, mentions] = await Promise.all([
    getMultipleIssuesPerRepositories(issueReferences),
    getMultipleUserByUsername(userMentions)
  ]);

  return {
    issues: new Map(
      issues.map((issue) => [
        issueReferenceKey(
          issue.repository_owner,
          issue.repository_name,
          issue.number
        ),
        issue
      ])
    ),
    mentions: new Map(
      mentions.map((user) => [user.username.toLowerCase(), user])
    )
  };
}

function getComponents({
  linkHeaders,
  editableCheckboxes,
  references,
  localIssueLinks,
  resolvedReferences,
  currentRepository
}: {
  linkHeaders: boolean;
  editableCheckboxes: boolean;
  references: Record<string, Reference>;
  localIssueLinks: Record<string, Extract<Reference, { type: "issue" }>>;
  resolvedReferences: ResolvedReferences;
  currentRepository: string;
}): Partial<Components> {
  Code.theme = {
    dark: githubDark,
    light: githubLight
  };

  return {
    blockquote: (props) => (
      <blockquote
        {...props}
        className="border-l-4 border-neutral  pl-4 text-grey"
      />
    ),
    video: (props) => (
      <details
        className="rounded-md border border-neutral"
        suppressHydrationWarning
      >
        <summary
          className={clsx(
            "py-2 px-4 cursor-pointer w-full",
            "[&::marker]:hidden [&::marker]:[content:'']",
            "inline-flex gap-1 items-center"
          )}
        >
          <DeviceCameraVideoIcon className="h-4" />
          <span className="sr-only">Video description</span>
          {props["aria-label"] ?? props.src}
          <TriangleDownIcon className="h-4" />
        </summary>
        <video
          muted={true}
          controls={true}
          className="rounded-b-md"
          src={props.src}
          poster={props.poster}
          preload="none"
        />
      </details>
    ),
    h1: (props) => <MarkdownH as="h1" showLink={linkHeaders} {...props} />,
    h2: (props) => <MarkdownH as="h2" showLink={linkHeaders} {...props} />,
    h3: (props) => <MarkdownH as="h3" showLink={linkHeaders} {...props} />,
    h4: (props) => <MarkdownH as="h4" showLink={linkHeaders} {...props} />,
    h5: (props) => <MarkdownH as="h5" showLink={linkHeaders} {...props} />,
    h6: (props) => <MarkdownH as="h6" showLink={linkHeaders} {...props} />,
    ul: (props) => {
      return (
        <ul
          {...props}
          {...{
            "data-task-list":
              props.className === "contains-task-list" ? "true" : undefined
          }}
          className={clsx(
            "my-2",
            {
              "pl-6": props.className === "contains-task-list",
              "pl-4": props.className !== "contains-task-list"
            },
            `[&>li:not([data-task-item])]:before:mx-1`,
            `[&>li:not([data-task-item])]:before:inline-block`,
            `[&>li:not([data-task-item])]:before:h-4`,
            `[&>li:not([data-task-item])]:before:font-extrabold`,
            `[&>li:not([data-task-item])]:before:text-foreground`,
            `[&>li:not([data-task-item])]:before:content-["•"]`,
            `[&>li:not([data-task-item])]:relative`,
            `[&>li:not([data-task-item])]:-left-4`
          )}
        />
      );
    },
    ol: (props) => {
      return (
        <ol
          {...props}
          className="list-decimal pl-4 [&_ol]:list-[lower-roman] my-2"
        />
      );
    },
    p: (props) => {
      return (
        <p suppressHydrationWarning {...props} className="mb-4">
          {props.children}
        </p>
      );
    },
    table: (props) => (
      <div className="max-w-full overflow-x-auto">
        <table
          {...props}
          className="w-max table-auto border-collapse border border-neutral"
        />
      </div>
    ),
    th: (props) => {
      return (
        <th
          {...props}
          className="border border-neutral px-5 py-2 text-left text-lg font-semibold"
        />
      );
    },
    tr: (props) => {
      return <tr {...props} className="even:bg-subtle" />;
    },
    td: (props) => {
      return <td {...props} className="border border-neutral px-5 py-2" />;
    },
    li: (props) => {
      return (
        <li
          {...props}
          {...{
            "data-task-item":
              props.className === "task-list-item" ? "true" : undefined
          }}
          className={clsx("mt-1.5", {
            "relative -left-4": props.className === "task-list-item"
          })}
        />
      );
    },
    hr: (props) => <hr className="h-1 bg-neutral/50 border-0" {...props} />,
    a: ({ href, children, ...props }) => {
      const localIssue =
        href && Object.hasOwn(localIssueLinks, href)
          ? localIssueLinks[href]
          : undefined;
      if (
        localIssue &&
        !resolvedReferences.issues.has(
          issueReferenceKey(
            localIssue.user,
            localIssue.project,
            Number(localIssue.no)
          )
        )
      )
        return <span>{children}</span>;

      return (
        <MarkdownA
          {...props}
          href={href}
          reference={
            href && Object.hasOwn(references, href)
              ? references[href]
              : undefined
          }
          currentRepository={currentRepository}
          resolvedReferences={resolvedReferences}
        >
          {children}
        </MarkdownA>
      );
    },
    pre: ({ children }) => (
      <div className="my-3 min-w-0 whitespace-pre-wrap">{children}</div>
    ),
    code: (props) => {
      const lang = props.className?.replace(`language-`, "");
      if (typeof props.children === "string" && props.children.length > 0) {
        // single backtick (`) are inline code, so we render them as a simple inline-code
        // they don't contains '\n' and they don't have a lang defined
        if (lang === undefined && !props.children.includes("\n")) {
          return (
            <code className="rounded-md bg-neutral px-1.5 py-1 text-sm">
              {props.children}
            </code>
          );
        }

        return (
          <MarkdownCodeBlock
            className={clsx("absolute right-2 top-7")}
            codeStr={props.children.trimEnd()}
          >
            <HighlightedCode lang={lang} code={props.children.trimEnd()} />
          </MarkdownCodeBlock>
        );
      } else {
        return <code>{props.children}</code>;
      }
    },
    img: ({ src, alt, width, height, title }) =>
      src ? (
        <a href={src} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            width={width}
            height={height}
            title={title}
            loading="lazy"
            alt={alt ?? ""}
          />
        </a>
      ) : (
        <span>{alt}</span>
      ),
    input: ({ checked }) => (
      <input
        type="checkbox"
        defaultChecked={checked}
        disabled={!editableCheckboxes}
      />
    )
  };
}

async function HighlightedCode({
  code,
  lang
}: {
  code: string;
  lang?: string;
}) {
  try {
    if (lang) await preload([lang]);
    return await Code({
      lang,
      code,
      codeClassName:
        "bg-neutral/30 rounded-md py-4 px-0.5 overflow-auto w-full min-w-0 text-sm",
      className: "w-full overflow-auto rounded-md text-sm min-w-0"
    });
  } catch {
    return (
      <pre className="w-full overflow-auto rounded-md bg-neutral/30 p-3 text-sm">
        <code>{code}</code>
      </pre>
    );
  }
}
