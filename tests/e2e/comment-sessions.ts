import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

export const repositoryPath = "/Fredkiss3/gh-next";
export const issuePath = (number: number) =>
  `${repositoryPath}/issues/${number}`;
export type FixtureRole = "author" | "owner" | "reader";

export const test = base.extend<{
  signedIn: (role: FixtureRole, path: string) => Promise<Page>;
}>({
  signedIn: async ({ browser, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role, path) => {
      if (!baseURL) throw new Error("Missing Playwright baseURL");
      const context = await browser.newContext({
        baseURL,
        extraHTTPHeaders: { "CF-Connecting-IP": "203.0.113.10" }
      });
      contexts.push(context);
      await context.route(
        "https://github.com/login/oauth/authorize?**",
        (route) => {
          const oauthUrl = new URL(route.request().url());
          const callback = new URL("/api/auth/callback", baseURL);
          callback.searchParams.set(
            "state",
            oauthUrl.searchParams.get("state") ?? ""
          );
          callback.searchParams.set("code", role);
          return route.fulfill({
            status: 302,
            headers: { location: callback.href }
          });
        }
      );

      const page = await context.newPage();
      await page.goto(`/login?nextUrl=${encodeURIComponent(path)}`);
      await page.getByRole("button", { name: "Login with GitHub" }).click();
      await expect(page).toHaveURL(path);
      await expect(
        page.getByRole("heading", { name: "Discussion", exact: true })
      ).toBeVisible();
      return page;
    });

    await Promise.all(contexts.map((context) => context.close()));
  }
});

export const authorComment = (page: Page) =>
  page.getByRole("article", { name: "Comment by FixtureAuthor" });

export async function publish(page: Page, text: string) {
  await page.getByRole("textbox", { name: /Leave a comment/ }).fill(text);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page).toHaveURL(/\?comment=\d+#issuecomment-\d+$/);
  const card = authorComment(page);
  await expect(card).toBeVisible();
  return card;
}
