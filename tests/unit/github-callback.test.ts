import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  consumeState: vi.fn(),
  upsertUser: vi.fn(),
  generateForUser: vi.fn(),
  setCookie: vi.fn(),
  getSession: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("redirect to " + url);
  }
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: () => ({ set: mocks.setCookie }),
  headers: () => new Headers()
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("~/env", () => ({
  env: {
    GITHUB_CLIENT_ID: "fixture",
    GITHUB_SECRET: "fixture",
    GITHUB_REDIRECT_URI: "https://example.test/api/auth/callback"
  }
}));
vi.mock("~/models/user", () => ({
  getUserById: vi.fn(),
  githubUserSchema: {
    safeParse: (profile: unknown) => ({ success: true, data: profile })
  },
  getOrInsertUserFromGithubProfile: mocks.upsertUser
}));
vi.mock("~/actions/session.action", () => ({ getSession: mocks.getSession }));
vi.mock("~/lib/server/kv/index.server", () => ({
  kv: {
    get: mocks.getState,
    delete: mocks.consumeState
  }
}));

const request = {
  nextUrl: new URL(
    "https://example.test/api/auth/callback?code=fixture-code&state=fixture-state"
  ),
  headers: new Headers({ host: "example.test" })
} as NextRequest;
const profile = {
  login: "fixture-author",
  id: 17,
  name: "Fixture",
  avatar_url: "/avatar.png"
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({
    generateForUser: mocks.generateForUser,
    addFlash: vi.fn(),
    getCookie: () => ({ name: "session", value: "fixture-session" })
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps session creation inside the checked OAuth callback", async () => {
  const auth = await import("~/actions/auth.action");
  expect(auth).not.toHaveProperty("loginUser");

  const { GET } = await import("~/app/api/auth/callback/route");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "fixture" }))
    .mockResolvedValueOnce(Response.json(profile));
  vi.stubGlobal("fetch", fetch);
  mocks.getState.mockResolvedValue({
    origin: "https://example.test",
    nextUrl: "/"
  });
  mocks.upsertUser.mockResolvedValue([{ id: 10 }]);

  await expect(GET(request)).rejects.toThrow(
    "redirect to https://example.test/"
  );
  expect(mocks.consumeState).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(mocks.upsertUser).toHaveBeenCalledWith(profile);
  expect(mocks.generateForUser).toHaveBeenCalledWith({ id: 10 });
  expect(mocks.setCookie).toHaveBeenCalledWith({
    name: "session",
    value: "fixture-session"
  });
});

it("never issues a session when OAuth state or token exchange fails", async () => {
  const { GET } = await import("~/app/api/auth/callback/route");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.getState.mockResolvedValueOnce(null);
  await expect(GET(request)).rejects.toThrow("redirect to /");
  expect(fetch).not.toHaveBeenCalled();

  mocks.getState.mockResolvedValueOnce({ origin: "https://example.test" });
  fetch.mockResolvedValueOnce(
    Response.json({ error: "fixture exchange failure" })
  );
  await expect(GET(request)).rejects.toThrow("redirect to /");
  expect(mocks.upsertUser).not.toHaveBeenCalled();
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(mocks.setCookie).not.toHaveBeenCalled();
});
