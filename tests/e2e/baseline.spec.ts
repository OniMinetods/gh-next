import { expect, test as base } from "@playwright/test";

const repositoryPath = "/Fredkiss3/gh-next";
const issuesPath = `${repositoryPath}/issues`;

const test = base.extend<{ browserErrors: void }>({
  browserErrors: [
    async ({ page, baseURL }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.origin === baseURL ? route.continue() : route.abort();
      });

      await use();
      expect(errors, "unhandled browser errors").toEqual([]);
    },
    { auto: true }
  ]
});

test("the home page redirects to the default repository and loads its README", async ({
  page
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(repositoryPath);
  await expect(
    page.getByRole("heading", { name: "Baseline README" })
  ).toBeVisible();
});

test("an existing repository shows its identity and GitHub fixture stats", async ({
  page
}) => {
  await page.goto(repositoryPath);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: /^Star\s*\(12\)$/ })
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 1, name: /gh-next\s*Public/ })
  ).toBeVisible();
  await expect(
    main.getByRole("complementary").getByText("Baseline fixture repository")
  ).toBeVisible();
});

test("the issue list shows open issues and links to the issue detail", async ({
  page
}) => {
  await page.goto(issuesPath);
  const openIssue = page.getByRole("link", { name: "Baseline open issue" });
  await expect(openIssue).toBeVisible();
  await expect(
    page.getByText("Baseline closed issue", { exact: true })
  ).toHaveCount(0);
  await openIssue.click();
  await expect(page).toHaveURL(`${issuesPath}/42`);
  await expect(
    page.getByRole("heading", { name: /Baseline open issue/ })
  ).toBeVisible();
});

test("the issue list filters closed issues", async ({ page }) => {
  await page.goto(`${issuesPath}?q=is%3Aclosed`);
  await expect(
    page.getByRole("link", { name: "Baseline closed issue" })
  ).toBeVisible();
  await expect(
    page.getByText("Baseline open issue", { exact: true })
  ).toHaveCount(0);
});

test("a guest is sent to sign in before opening the new issue form", async ({
  page
}) => {
  const newIssuePath = `${issuesPath}/new`;
  await page.goto(newIssuePath);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/login" &&
      url.searchParams.get("nextUrl") === newIssuePath
  );
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("an existing issue renders Markdown heading, emphasis, link and task list", async ({
  page
}) => {
  await page.goto(`${issuesPath}/42`);
  const issue = page.getByRole("main");
  await expect(
    issue.getByRole("heading", { name: "Baseline issue details" })
  ).toBeVisible();
  await expect(
    issue.locator("strong").filter({ hasText: "rendered emphasis" })
  ).toBeVisible();
  await expect(
    issue.getByRole("link", { name: "repository link" })
  ).toHaveAttribute("href", repositoryPath);
  await expect(issue.getByRole("checkbox")).toBeChecked();
  await expect(issue.getByRole("checkbox")).toBeDisabled();
});
