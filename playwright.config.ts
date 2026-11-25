import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 53000;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    // A stable public-shaped test address avoids the middleware's IP lookup.
    extraHTTPHeaders: { "CF-Connecting-IP": "203.0.113.10" }
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL
    }
  }],
  webServer: {
    command: `node tests/e2e/prepare-database.mjs && pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/favicon.png`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL:
        "postgresql://gh_next_e2e:e2e-only@127.0.0.1:55433/gh_next_e2e",
      REDIS_HTTP_URL: "http://127.0.0.1:56380",
      REDIS_HTTP_USERNAME: "user",
      REDIS_HTTP_PASSWORD: "password",
      KV_PREFIX: "gh_next_e2e_",
      SESSION_SECRET: "gh-next-e2e-placeholder-00000000",
      NEXT_PUBLIC_VERCEL_URL: `localhost:${port}`,
      GITHUB_CLIENT_ID: "gh-next-e2e",
      GITHUB_SECRET: "gh-next-e2e",
      GITHUB_PERSONAL_ACCESS_TOKEN: "gh-next-e2e",
      GITHUB_REDIRECT_URI: `${baseURL}/api/auth/callback`,
      SKIP_ENV_VALIDATION: "0",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: resolve("tests/e2e/google-fonts.json"),
      GH_NEXT_E2E: "1",
      NODE_OPTIONS: "--import=./tests/e2e/mock-external-fetch.mjs"
    }
  }
});
