const appFetch = globalThis.fetch;
const repositoryPath = "Fredkiss3/gh-next";
const readmeUrl = `https://raw.githubusercontent.com/${repositoryPath}/main/README.md`;
const localOrigins = new Set([
  "http://127.0.0.1:53000",
  "http://localhost:53000",
  "http://127.0.0.1:56380"
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

  throw new Error(
    `Unexpected server fetch in E2E: ${url.origin}${url.pathname}`
  );
};
