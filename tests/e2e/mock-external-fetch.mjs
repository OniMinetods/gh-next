const appFetch = globalThis.fetch;
const profiles = {
  owner: { id: 900000001, login: "Fredkiss3", name: "Fixture Maintainer" },
  author: { id: 900000002, login: "FixtureAuthor", name: "Fixture Author" },
  reader: { id: 900000003, login: "FixtureReader", name: "Fixture Reader" }
};
const repositoryPath = "Fredkiss3/gh-next";
const readmeUrl = `https://raw.githubusercontent.com/${repositoryPath}/main/README.md`;
const localOrigins = new Set([
  "http://127.0.0.1:53000",
  "http://localhost:53000",
  "http://127.0.0.1:56380",
  "http://webdis:7379"
]);

// Installed before Next.js wraps fetch, so server-rendered pages use these fixtures.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (localOrigins.has(url.origin)) return appFetch(input, init);

  if (url.href === readmeUrl) {
    return new Response(
      "# Baseline README\n\nThis README comes from the **GitHub fixture**.\n",
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  if (url.href === "https://github.com/login/oauth/access_token") {
    const request = new Request(input, init);
    const { code, client_id } = await request.json();
    if (client_id === "gh-next-e2e" && Object.hasOwn(profiles, code)) {
      return Response.json({ access_token: "fixture:" + code });
    }
    return Response.json({ error: "bad_verification_code" }, { status: 400 });
  }

  if (url.href === "https://api.github.com/user") {
    const request = new Request(input, init);
    const role = request.headers.get("Authorization")?.replace(/^token fixture:/, "");
    if (role && Object.hasOwn(profiles, role)) {
      return Response.json({ ...profiles[role], avatar_url: "/favicon.png" });
    }
    return Response.json({ message: "Bad credentials" }, { status: 401 });
  }

  if (url.href === "https://api.github.com/graphql") {
    const request = new Request(input, init);
    if (request.method !== "POST") {
      throw new Error("Expected a POST to GitHub GraphQL in E2E.");
    }
    const { query, variables } = await request.json();
    if (`${variables?.repoOwner}/${variables?.repoName}` !== repositoryPath) {
      throw new Error("Unexpected repository in the GitHub GraphQL request.");
    }

    if (query.includes("languages(")) {
      return Response.json({
        data: {
          repository: {
            url: `https://github.com/${repositoryPath}`,
            description: "Baseline fixture repository",
            forkCount: 3,
            stargazerCount: 12,
            watchers: { totalCount: 2 },
            languages: {
              totalSize: 100,
              totalCount: 1,
              edges: [
                { size: 100, node: { name: "TypeScript", color: "#3178c6" } }
              ]
            }
          }
        }
      });
    }

    if (query.includes("stargazers(")) {
      return Response.json({
        data: {
          repository: {
            stargazers: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: []
            }
          }
        }
      });
    }
  }

  if (url.origin === "https://lighter.codehike.org" && url.pathname.startsWith("/grammars/")) {
    return new Response(null, { status: 503 });
  }

  throw new Error(
    `Unexpected server fetch in E2E: ${url.origin}${url.pathname}`
  );
};
