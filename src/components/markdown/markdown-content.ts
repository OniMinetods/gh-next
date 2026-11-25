import { randomUUID } from "node:crypto";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkBreaks from "remark-breaks";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkGithub from "remark-github";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { PRODUCTION_DOMAIN } from "~/lib/shared/constants";
import type { Options } from "rehype-sanitize";
import type { Reference } from "./markdown-a";

const idPrefix = "user-content-";

const schema: Options = {
  ...defaultSchema,
  clobberPrefix: idPrefix,
  tagNames: [...(defaultSchema.tagNames ?? []), "kbd", "video"],
  strip: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "template"
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": ["dir", "id", "lang", "title"],
    code: [["className", /^language-[\w+#.-]+$/]],
    details: ["open"],
    img: ["alt", "src", "height", "width"],
    input: [["type", "checkbox"], "checked", ["disabled", true]],
    ol: [...(defaultSchema.attributes?.ol ?? []), "start"],
    source: [],
    td: ["colSpan", "rowSpan", ["align", "left", "center", "right"]],
    th: ["colSpan", "rowSpan", "scope", ["align", "left", "center", "right"]],
    video: ["src", "poster", "height", "width", "ariaLabel"]
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https"],
    poster: ["http", "https"],
    href: ["http", "https", "mailto"]
  }
};

export async function parseMarkdown(content: string, repository: string) {
  const localIssueLinks: Record<
    string,
    Extract<Reference, { type: "issue" }>
  > = {};
  const referencePrefix = "#reference-" + randomUUID() + "-";
  const references: Record<string, Reference> = {};
  let index = 0;

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkGithub, {
      repository,
      mentionStrong: false,
      baseURL: PRODUCTION_DOMAIN.replaceAll(".", "\\."),
      buildUrl(reference) {
        if (reference.type === "compare") return false;
        // Only the Markdown reference parser can supply a matching marker.
        const marker = referencePrefix + index++;
        references[marker] = reference;
        return marker;
      }
    })
    .use(remarkGemoji)
    .use(remarkBreaks)
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: "" })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeSanitize, schema);

  const tree = await processor.run(processor.parse(content));

  // Preserve intra-document links when the sanitizer prefixes their targets.
  const ids = new Set<string>();
  const links: { href: string; properties: Record<string, unknown> }[] = [];
  function collect(node: (typeof tree.children)[number]) {
    if (node.type !== "element") return;
    const { id, href } = node.properties;
    if (typeof id === "string") ids.add(id);
    if (node.tagName === "a" && typeof href === "string") {
      links.push({ href, properties: node.properties });
    }
    node.children.forEach(collect);
  }
  tree.children.forEach(collect);
  for (const { href, properties } of links) {
    if (Object.hasOwn(references, href)) continue;
    const localIssue =
      /^\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?(?:[?#]|$)/.exec(href);
    if (localIssue) {
      const [, user, project, no] = localIssue;
      localIssueLinks[href] = { type: "issue", user, project, no };
    }
    if (!href.startsWith("#")) continue;
    try {
      if (ids.has(idPrefix + decodeURIComponent(href.slice(1)))) {
        properties.href = "#" + idPrefix + href.slice(1);
      }
    } catch {
      // An invalid escape cannot identify a heading.
    }
  }

  return { tree, references, localIssueLinks };
}
