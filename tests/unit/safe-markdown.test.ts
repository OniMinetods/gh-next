import { describe, expect, it } from "vitest";
import { parseMarkdown } from "~/components/markdown/markdown-content";

type Tree = Awaited<ReturnType<typeof parseMarkdown>>["tree"];
type Node = Tree["children"][number];

function elements(tree: Tree) {
  function flatten(node: Node): Extract<Node, { type: "element" }>[] {
    return node.type === "element"
      ? [node, ...node.children.flatMap(flatten)]
      : [];
  }
  return tree.children.flatMap(flatten);
}

describe("safe Markdown", () => {
  it("retains GFM tables, fenced code, task lists and safe HTML", async () => {
    const markdown = [
      "| Column |",
      "| :-- |",
      "| **bold** |",
      "",
      "- [x] Checked",
      "",
      "```js",
      "const n = 42;",
      "```",
      "",
      "<details><summary>More</summary><kbd>Enter</kbd></details>"
    ].join("\n");
    const { tree } = await parseMarkdown(markdown, "Fredkiss3/gh-next");
    const tags = elements(tree);
    expect(tags.map(({ tagName }) => tagName)).toEqual(
      expect.arrayContaining([
        "table",
        "th",
        "td",
        "strong",
        "ul",
        "pre",
        "code",
        "details",
        "summary",
        "kbd"
      ])
    );
    expect(
      tags.find(({ tagName }) => tagName === "input")?.properties
    ).toMatchObject({
      type: "checkbox",
      checked: true,
      disabled: true
    });
    expect(
      tags.find(({ tagName }) => tagName === "code")?.properties.className
    ).toEqual(["language-js"]);
  });

  it("strips active elements, inline handlers, unsafe URLs and untrusted attributes", async () => {
    const { tree } = await parseMarkdown(
      [
        "[Unsafe](javascript:ignored)",
        "",
        '<a href="java&#x09;script:ignored" onclick="ignored" style="color:red">raw</a>',
        '<img alt="placeholder" src="data:image/svg+xml,ignored" onerror="ignored">',
        '<video src="javascript:ignored" poster="data:ignored" autoplay></video>',
        "<script>removed-script</script><style>removed-style</style><svg><a>removed-svg</a></svg>",
        '<a href="https://example.test/path">Safe</a>'
      ].join("\n"),
      "Fredkiss3/gh-next"
    );

    const markup = JSON.stringify(tree);
    expect(markup).not.toMatch(
      /javascript:|data:image|onClick|onError|style|autoPlay|removed-/i
    );
    expect(
      elements(tree)
        .filter(({ tagName }) => tagName === "a")
        .map((node) => node.properties.href)
    ).toEqual([undefined, undefined, "https://example.test/path"]);
  });

  it("prefixes IDs while preserving local fragments and marking only parsed references", async () => {
    const { tree, references, localIssueLinks } = await parseMarkdown(
      [
        "# Heading",
        "",
        "[Local](#heading) and #42",
        "",
        '<a href="/Fredkiss3/gh-next/issues/42?type=issue&user=Fredkiss3&project=gh-next&no=42">Plain HTML link</a>'
      ].join("\n"),
      "Fredkiss3/gh-next"
    );
    const tags = elements(tree);
    expect(tags.find(({ tagName }) => tagName === "h1")?.properties.id).toBe(
      "user-content-heading"
    );
    const links = tags
      .filter(({ tagName }) => tagName === "a")
      .map(({ properties }) => String(properties.href));
    expect(links[0]).toBe("#user-content-heading");
    expect(Object.keys(references)).toEqual([links[1]]);
    expect(references[links[1]]).toMatchObject({
      type: "issue",
      user: "Fredkiss3",
      project: "gh-next",
      no: "42"
    });
    expect(links[2]).toContain("?type=issue");
    expect(localIssueLinks[links[2]]).toMatchObject({
      user: "Fredkiss3",
      project: "gh-next",
      no: "42"
    });
  });
});
