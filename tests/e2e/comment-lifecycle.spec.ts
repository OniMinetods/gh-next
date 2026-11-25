import { expect } from "@playwright/test";
import { authorComment, issuePath, publish, test } from "./comment-sessions";

test.describe.configure({ timeout: 120_000 });

test("publishes from preview, edits with accessible history, deletes and restores after reload", async ({
  signedIn,
  page: guest
}) => {
  const path = issuePath(50);
  const author = await signedIn("author", path);
  const editor = author.getByRole("textbox", { name: /Leave a comment/ });
  await editor.fill("**First published version**");
  const writeTab = author.getByRole("tab", { name: "Write" });
  await writeTab.focus();
  await expect(writeTab).toBeFocused();
  await writeTab.press("ArrowRight");
  await expect(author.getByRole("tab", { name: "Preview" })).toBeFocused();
  await author.keyboard.press("Enter");
  await expect(author.getByRole("tabpanel").locator("strong")).toHaveText(
    "First published version"
  );
  await author.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(author).toHaveURL(/\?comment=\d+#issuecomment-\d+$/);
  const permalink =
    new URL(author.url()).pathname +
    new URL(author.url()).search +
    new URL(author.url()).hash;
  const card = authorComment(author);
  await expect(card.locator("strong")).toHaveText("First published version");
  await author.reload();
  await expect(card).toHaveCount(1);

  const createdAt = await card.locator("time").getAttribute("datetime");
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await card
    .getByRole("textbox", { name: /Edit comment/ })
    .fill("**Updated version**");
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.locator("strong")).toHaveText("Updated version");
  const history = card.getByRole("button", { name: /^Edited/ });
  await expect(history).toBeVisible();
  await expect(card.locator("header time")).toHaveAttribute(
    "datetime",
    createdAt!
  );
  await history.focus();
  await author.keyboard.press("Enter");
  await expect(
    card.getByRole("region", { name: "Comment history" }).locator("strong")
  ).toHaveText("First published version");
  await expect(card.getByRole("link", { name: /Permalink/ })).toHaveAttribute(
    "href",
    permalink
  );

  await card.getByRole("button", { name: "Delete" }).click();
  await expect(author.getByText("This comment was deleted.")).toBeVisible();
  await author.reload();
  await guest.goto(permalink);
  await expect(guest.getByText("This comment was deleted.")).toBeVisible();
  await expect(guest.getByText("Updated version")).toHaveCount(0);

  await author.getByText("My deleted comments", { exact: true }).click();
  await author.getByRole("button", { name: "Restore" }).click();
  await expect(card.locator("strong")).toHaveText("Updated version");
  await expect(card.getByRole("link", { name: /Permalink/ })).toHaveAttribute(
    "href",
    permalink
  );
  await card.getByRole("button", { name: /^Edited/ }).click();
  await expect(
    card
      .getByRole("region", { name: "Comment history" })
      .getByText("First published version")
  ).toBeVisible();
});

test("reloads a stale edit and retains its draft until the author retries", async ({
  signedIn
}) => {
  const first = await signedIn("author", issuePath(53));
  const firstCard = await publish(first, "Original concurrency body");
  const second = await first.context().newPage();
  await second.goto(first.url());
  const secondCard = authorComment(second);

  await secondCard.getByRole("button", { name: "Edit", exact: true }).click();
  await secondCard
    .getByRole("textbox", { name: /Edit comment/ })
    .fill("Draft from the other tab");
  await firstCard.getByRole("button", { name: "Edit", exact: true }).click();
  await firstCard
    .getByRole("textbox", { name: /Edit comment/ })
    .fill("Confirmed by the first tab");
  await firstCard.getByRole("button", { name: "Save changes" }).click();
  await expect(
    firstCard.getByText("Confirmed by the first tab", { exact: true })
  ).toBeVisible();

  await secondCard.getByRole("button", { name: "Save changes" }).click();
  await expect(secondCard.getByRole("alert")).toHaveText(
    /Review the latest version/
  );
  await expect(
    secondCard.getByText("Confirmed by the first tab", { exact: true })
  ).toBeVisible();
  await expect(
    secondCard.getByRole("textbox", { name: /Edit comment/ })
  ).toHaveValue("Draft from the other tab");

  await secondCard.getByRole("button", { name: "Save changes" }).click();
  await expect(
    secondCard.getByRole("textbox", { name: /Edit comment/ })
  ).toHaveCount(0);
  await expect(
    secondCard.getByText("Draft from the other tab", { exact: true })
  ).toBeVisible();
  await secondCard.getByRole("button", { name: /^Edited/ }).click();
  const history = secondCard.getByRole("region", { name: "Comment history" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history.getByText("Confirmed by the first tab")).toBeVisible();
  await expect(history.getByText("Original concurrency body")).toBeVisible();
});

test("rolls back an unconfirmed submission and reuses its request after reload", async ({
  signedIn
}) => {
  const path = issuePath(55);
  const page = await signedIn("author", path);
  const discussion = page.getByRole("region", {
    name: "Discussion",
    exact: true
  });
  const editor = discussion.getByRole("textbox", { name: /Leave a comment/ });
  const submit = discussion.getByRole("button", {
    name: "Comment",
    exact: true
  });
  await page.waitForLoadState("load");
  const clientScripts = "**/_next/static/**/*.js";
  let resumeScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    resumeScripts = resolve;
  });
  await page.route(clientScripts, async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: "commit" });
    await expect(submit).toBeDisabled();
    await expect(editor).not.toBeEditable();
  } finally {
    resumeScripts();
    await page.unrouteAll({ behavior: "wait" });
  }

  await expect(submit).toBeEnabled();
  await editor.fill("   ");
  await submit.click();
  await expect(discussion.getByRole("alert")).toHaveText(/non-empty comment/);
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toHaveValue("   ");
  await expect(page).toHaveURL(path);
  await expect(authorComment(page)).toHaveCount(0);

  await editor.fill("Retry this single publication");
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (intercepted || route.request().method() !== "POST")
        return route.continue();
      intercepted = true;
      await wait;
      await route.fetch();
      await route.abort();
    }
  );

  await submit.click();
  try {
    await expect(
      page.getByRole("status").filter({ hasText: "Posting comment" })
    ).toBeVisible();
    await expect(
      page.getByText("Retry this single publication", { exact: true })
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(discussion.getByRole("alert")).toHaveText(
    /Could not confirm the save/
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Posting comment" })
  ).toHaveCount(0);
  await expect(editor).toHaveValue("Retry this single publication");

  await page.reload();
  await expect(editor).toHaveValue("Retry this single publication");
  await submit.click();
  await expect(page).toHaveURL(/\?comment=\d+#issuecomment-\d+$/);
  await expect(authorComment(page)).toHaveCount(1);
  await page.goto(path);
  await expect(authorComment(page)).toHaveCount(1);
});
