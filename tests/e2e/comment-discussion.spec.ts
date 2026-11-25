import { expect } from "@playwright/test";
import { Pool } from "pg";
import { CacheKeys } from "../../src/lib/shared/cache-keys.shared";
import {
  authorComment,
  issuePath,
  publish,
  repositoryPath,
  test
} from "./comment-sessions";

test.describe.configure({ timeout: 120_000 });

async function cacheEntry(commentId: number, version: number) {
  const pool = new Pool({
    connectionString:
      "postgresql://gh_next_e2e:e2e-only@127.0.0.1:55433/gh_next_e2e"
  });
  try {
    const { rows } = await pool.query<{ id: number }>(
      "select id from gh_next_repositories where name = $1",
      ["gh-next"]
    );
    const key =
      "gh_next_e2e_gh_next_e2e_" +
      CacheKeys.markdownTree(
        CacheKeys.commentMarkdown(rows[0].id, commentId, version)
      ).join("-");
    const response = await fetch(`http://127.0.0.1:56380/GET/${key}`, {
      method: "PUT",
      headers: {
        Authorization:
          "Basic " + Buffer.from("user:password").toString("base64")
      }
    });
    expect(response.ok).toBe(true);
    const { GET } = (await response.json()) as { GET: string | null };
    return GET ?? "";
  } finally {
    await pool.end();
  }
}

test("applies moderation privileges and keeps warmed comment Markdown private after hiding", async ({
  signedIn,
  page: guest
}) => {
  const path = issuePath(51);
  const author = await signedIn("author", path);
  const card = await publish(author, "moderationoldtoken");
  const permalink = (await card
    .getByRole("link", { name: /Permalink/ })
    .getAttribute("href"))!;
  const id = Number(new URL(author.url()).searchParams.get("comment"));

  await guest.goto(permalink);
  await expect(authorComment(guest)).toHaveText(/moderationoldtoken/);
  await expect.poll(() => cacheEntry(id, 0)).toContain("moderationoldtoken");
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await card
    .getByRole("textbox", { name: /Edit comment/ })
    .fill("moderationnewtoken");
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText("moderationnewtoken")).toBeVisible();
  await guest.reload();
  await expect(authorComment(guest)).toHaveText(/moderationnewtoken/);
  await expect.poll(() => cacheEntry(id, 1)).toContain("moderationnewtoken");

  const reader = await signedIn("reader", permalink);
  const readerCard = authorComment(reader);
  await expect(readerCard).toBeVisible();
  await expect(
    readerCard.getByRole("button", { name: /^(Edit|Delete|Hide|Unhide)$/ })
  ).toHaveCount(0);
  const owner = await signedIn("owner", permalink);
  const ownerCard = authorComment(owner);
  await expect(
    ownerCard.getByRole("button", { name: "Edit", exact: true })
  ).toHaveCount(0);
  await ownerCard.getByRole("button", { name: "Hide", exact: true }).click();
  await ownerCard.getByRole("button", { name: "Hide comment" }).click();
  await expect(ownerCard).toBeVisible();
  await ownerCard.getByLabel("Reason for hiding").selectOption("SPAM");
  await ownerCard.getByRole("button", { name: "Hide comment" }).click();
  await expect(owner.getByText("This comment is hidden · Spam.")).toBeVisible();

  for (const page of [guest, reader]) {
    const response = await page.reload();
    await expect(
      page.getByText("This comment is hidden · Spam.")
    ).toBeVisible();
    await expect(authorComment(page)).toHaveCount(0);
    expect(await response?.text()).not.toMatch(/moderation(?:old|new)token/);
    await expect(
      page.getByRole("button", { name: /View hidden comment/ })
    ).toHaveCount(0);
  }
  const search = `${repositoryPath}/issues?q=${encodeURIComponent("in:comments moderationnewtoken")}`;
  await reader.goto(search);
  await expect(
    reader.getByRole("link", { name: "Moderation fixture" })
  ).toHaveCount(0);

  const unavailable = owner.getByRole("article", {
    name: "Unavailable comment"
  });
  await unavailable
    .getByRole("button", { name: "View hidden comment and history" })
    .click();
  await expect(unavailable.getByText("moderationoldtoken")).toBeVisible();
  await expect(unavailable.getByText("moderationnewtoken")).toBeVisible();
  await unavailable.getByRole("button", { name: "Unhide" }).click();
  await expect(
    authorComment(owner).getByText("moderationnewtoken")
  ).toBeVisible();
  await guest.reload();
  await expect(
    authorComment(guest).getByText("moderationnewtoken")
  ).toBeVisible();
  await reader.reload();
  await expect(
    reader.getByRole("link", { name: "Moderation fixture" })
  ).toBeVisible();
});

test("paginates tied timestamps, focuses a permalink and displays a legacy diff as text", async ({
  page
}) => {
  const path = issuePath(52);
  await page.goto(path + "?cursor=bad!");
  const list = page.getByRole("list", { name: "Issue comments" });
  await expect(list.locator(":scope > li")).toHaveCount(25);
  await expect(
    list.getByText("Imported comment 1", { exact: true })
  ).toBeVisible();
  await expect(
    list.getByText("Imported comment 26", { exact: true })
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(list.locator(":scope > li")).toHaveCount(1);
  const card = list.getByRole("article", { name: "Comment by ImportedAuthor" });
  await expect(card.getByText("Imported comment 26")).toBeVisible();
  const permalink = (await card
    .getByRole("link", { name: /Permalink/ })
    .getAttribute("href"))!;
  await page.goto(permalink);
  await expect(card).toBeFocused();
  await expect(card.locator("header time")).toHaveAttribute(
    "datetime",
    /^2023-01-01T/
  );

  const history = card.getByRole("button", { name: /^Edited/ });
  await history.focus();
  await page.keyboard.press("Enter");
  const revisions = card.getByRole("region", { name: "Comment history" });
  await expect(
    revisions.getByRole("heading", { name: /GitHub diff/ })
  ).toBeVisible();
  await expect(revisions.locator("pre")).toContainText("+ <b>Literal diff</b>");
  await expect(revisions.locator("b")).toHaveCount(0);
});

test("applies the same Markdown policy to preview, current text and history", async ({
  signedIn
}) => {
  const page = await signedIn("author", issuePath(56));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: /<b>Literal issue title<\/b>/ })
  ).toBeVisible();
  const markdown = [
    "| Header |",
    "| --- |",
    "| **Useful table** |",
    "",
    "- [x] Task",
    "",
    "```js",
    "const safeCode = true;",
    "```",
    "",
    "[Bad link](javascript:ignored)",
    "",
    "<script>removed-script</script><img alt='blocked image' src='data:image/svg+xml,ignored' onerror='ignored'>",
    "",
    "#50 and Fredkiss3/other-discussion-fixture#50 and Fredkiss3/private-discussion-fixture#50",
    "",
    "[Private relative link](/Fredkiss3/private-discussion-fixture/issues/50) and [GitHub link](https://github.com/example/project/issues/99)"
  ].join("\n");

  await page.getByRole("textbox", { name: /Leave a comment/ }).fill(markdown);
  await page.getByRole("tab", { name: "Preview" }).click();
  const preview = page.getByRole("tabpanel").getByRole("article");
  await expect(preview.getByRole("table")).toHaveCount(1);
  await expect(preview.getByRole("checkbox")).toBeChecked();
  await expect(preview.getByText("Bad link")).toBeVisible();
  await expect(preview.getByRole("link", { name: "Bad link" })).toHaveCount(0);
  await expect(
    preview.getByRole("link", { name: /Comment lifecycle fixture/ })
  ).toHaveAttribute("href", issuePath(50));
  await expect(
    preview.getByRole("link", { name: /Other repository issue/ })
  ).toHaveAttribute("href", "/Fredkiss3/other-discussion-fixture/issues/50");
  await expect(
    preview.getByRole("link", { name: /private-discussion-fixture/ })
  ).toHaveCount(0);
  await expect(preview.getByText("Private fixture title")).toHaveCount(0);
  await expect(preview.getByText("Private relative link")).toBeVisible();
  await expect(
    preview.getByRole("link", { name: "Private relative link" })
  ).toHaveCount(0);
  await expect(
    preview.getByRole("link", { name: "GitHub link" })
  ).toHaveAttribute("href", "https://github.com/example/project/issues/99");
  const discussion = page.getByRole("region", {
    name: "Discussion",
    exact: true
  });
  expect(
    await discussion.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);

  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page).toHaveURL(/\?comment=\d+#issuecomment-\d+$/);
  const card = authorComment(page);
  await expect(card.getByRole("table")).toHaveCount(1);
  await expect(
    card.locator("code").filter({ hasText: "safeCode" })
  ).toBeVisible();
  await expect(
    card.locator(
      'script, img[onerror], a[href^="javascript:"], img[src^="data:"]'
    )
  ).toHaveCount(0);

  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await card
    .getByRole("textbox", { name: /Edit comment/ })
    .fill("Plain replacement body");
  await card.getByRole("button", { name: "Save changes" }).click();
  await card.getByRole("button", { name: /^Edited/ }).click();
  const history = card.getByRole("region", { name: "Comment history" });
  await expect(history.getByRole("table")).toHaveCount(1);
  await expect(history.getByRole("checkbox")).toBeDisabled();
  await expect(
    history.locator(
      'script, img[onerror], a[href^="javascript:"], img[src^="data:"]'
    )
  ).toHaveCount(0);
});

test("author and owner sessions observe the locked, private and archived issue rules", async ({
  signedIn
}) => {
  const author = await signedIn("author", issuePath(54));
  await expect(author.getByText("This discussion is locked.")).toBeVisible();
  await expect(
    author.getByRole("textbox", { name: /Leave a comment/ })
  ).toHaveCount(0);
  const owner = await signedIn("owner", issuePath(54));
  await expect(
    owner.getByRole("textbox", { name: /Leave a comment/ })
  ).toBeVisible();

  await author.goto("/Fredkiss3/archived-discussion-fixture/issues/50");
  await expect(
    author.getByText("This repository is archived. Discussion is read-only.")
  ).toBeVisible();
  await author.goto("/Fredkiss3/private-discussion-fixture/issues/50");
  await expect(author.getByText("Private issue content")).toHaveCount(0);
  await expect(
    author.getByRole("heading", { name: "Discussion", exact: true })
  ).toHaveCount(0);
});
