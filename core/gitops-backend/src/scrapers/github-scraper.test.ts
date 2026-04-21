import { describe, it, expect } from "bun:test";
import { githubScraper } from "./github-scraper";
import type { ScraperOptions, FetchFn } from "./types";
import type { Logger } from "@checkstack/backend-api";

const mockLogger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

/**
 * Creates a mock fetch that returns pre-configured responses based on URL patterns.
 */
function createMockFetch(
  handlers: Array<{
    pattern: string | RegExp;
    response: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
): FetchFn {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    for (const handler of handlers) {
      const matches =
        typeof handler.pattern === "string"
          ? url.includes(handler.pattern)
          : handler.pattern.test(url);

      if (matches) {
        return new Response(JSON.stringify(handler.response), {
          status: handler.status ?? 200,
          headers: {
            "Content-Type": "application/json",
            ...handler.headers,
          },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

const BASE_OPTIONS: Omit<ScraperOptions, "fetch"> = {
  target: "my-org",
  pathPattern: ".checkstack/**/*.yaml",
  authToken: "ghp_test_token",
  logger: mockLogger,
};

describe("githubScraper", () => {
  it("discovers files from a single repo target", async () => {
    const mockFetch = createMockFetch([
      {
        pattern: /repos\/my-org\/my-repo\/git\/trees/,
        response: {
          sha: "abc",
          tree: [
            { path: ".checkstack/systems.yaml", type: "blob" },
            { path: "README.md", type: "blob" },
            { path: "src", type: "tree" },
          ],
          truncated: false,
        },
      },
      {
        pattern: /repos\/my-org\/my-repo\/contents\//,
        response: {
          content: btoa("apiVersion: checkstack.io/v1alpha1"),
          encoding: "base64",
        },
      },
      {
        pattern: /repos\/my-org\/my-repo$/,
        response: { full_name: "my-org/my-repo", default_branch: "main" },
      },
    ]);

    const files = await githubScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "my-org/my-repo",
      fetch: mockFetch,
    });

    expect(files).toHaveLength(1);
    expect(files[0].repository).toBe("my-org/my-repo");
    expect(files[0].filePath).toBe(".checkstack/systems.yaml");
    expect(files[0].content).toBe("apiVersion: checkstack.io/v1alpha1");
    expect(files[0].branch).toBe("main");
  });

  it("enumerates repos from an org target", async () => {
    const mockFetch = createMockFetch([
      {
        pattern: "orgs/my-org/repos",
        response: [
          { full_name: "my-org/repo-a", default_branch: "main" },
          { full_name: "my-org/repo-b", default_branch: "develop" },
        ],
      },
      {
        pattern: "my-org/repo-a/git/trees",
        response: {
          sha: "abc",
          tree: [{ path: ".checkstack/sys.yaml", type: "blob" }],
          truncated: false,
        },
      },
      {
        pattern: "my-org/repo-b/git/trees",
        response: { sha: "def", tree: [], truncated: false },
      },
      {
        pattern: "repo-a/contents",
        response: { content: btoa("yaml-content"), encoding: "base64" },
      },
    ]);

    const files = await githubScraper.discoverFiles({
      ...BASE_OPTIONS,
      fetch: mockFetch,
    });

    expect(files).toHaveLength(1);
    expect(files[0].repository).toBe("my-org/repo-a");
    expect(files[0].branch).toBe("main");
  });

  it("falls back to user endpoint when org returns 404", async () => {
    let userEndpointCalled = false;

    const mockFetch = createMockFetch([
      {
        pattern: "orgs/my-user/repos",
        response: { message: "Not Found" },
        status: 404,
      },
      {
        pattern: "users/my-user/repos",
        response: [
          { full_name: "my-user/personal-repo", default_branch: "main" },
        ],
      },
      {
        pattern: "personal-repo/git/trees",
        response: { sha: "abc", tree: [], truncated: false },
      },
    ]);

    // Wrap to detect user endpoint call
    const wrappedFetch: FetchFn = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("users/my-user")) userEndpointCalled = true;
      return mockFetch(input, init);
    };

    await githubScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "my-user",
      fetch: wrappedFetch,
    });

    expect(userEndpointCalled).toBe(true);
  });

  it("filters files using minimatch pattern", async () => {
    const mockFetch = createMockFetch([
      {
        pattern: /repos\/my-org\/repo\/git\/trees/,
        response: {
          sha: "abc",
          tree: [
            { path: ".checkstack/systems.yaml", type: "blob" },
            { path: ".checkstack/deep/nested.yaml", type: "blob" },
            { path: "other/file.yaml", type: "blob" },
            { path: ".checkstack/readme.md", type: "blob" },
          ],
          truncated: false,
        },
      },
      {
        pattern: /repos\/my-org\/repo\/contents\//,
        response: { content: btoa("content"), encoding: "base64" },
      },
      {
        pattern: /repos\/my-org\/repo$/,
        response: { full_name: "my-org/repo", default_branch: "main" },
      },
    ]);

    const files = await githubScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "my-org/repo",
      fetch: mockFetch,
    });

    // Should match .checkstack/**/*.yaml only
    expect(files).toHaveLength(2);
    expect(files[0].filePath).toBe(".checkstack/systems.yaml");
    expect(files[1].filePath).toBe(".checkstack/deep/nested.yaml");
  });

  it("handles pagination via Link header", async () => {
    const mockFetch: FetchFn = async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("orgs/big-org/repos") && !url.includes("page=2")) {
        return new Response(
          JSON.stringify([
            { full_name: "big-org/repo-1", default_branch: "main" },
          ]),
          {
            headers: {
              "Content-Type": "application/json",
              Link: '<https://api.github.com/orgs/big-org/repos?per_page=100&page=2>; rel="next"',
            },
          },
        );
      }

      if (url.includes("page=2")) {
        return new Response(
          JSON.stringify([
            { full_name: "big-org/repo-2", default_branch: "main" },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("git/trees")) {
        return new Response(
          JSON.stringify({ sha: "abc", tree: [], truncated: false }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const files = await githubScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "big-org",
      fetch: mockFetch,
    });

    // Both repos processed but no matching files
    expect(files).toHaveLength(0);
  });

  it("continues on individual file fetch errors", async () => {
    const mockFetch: FetchFn = async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      // Content requests
      if (url.includes("contents/") && url.includes("bad.yaml")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (url.includes("contents/") && url.includes("good.yaml")) {
        return new Response(
          JSON.stringify({ content: btoa("good"), encoding: "base64" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      // Tree request
      if (url.includes("git/trees")) {
        return new Response(
          JSON.stringify({
            sha: "abc",
            tree: [
              { path: ".checkstack/good.yaml", type: "blob" },
              { path: ".checkstack/bad.yaml", type: "blob" },
            ],
            truncated: false,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      // Repo metadata (must be last — matches broadly)
      if (url.includes("repos/my-org/repo")) {
        return new Response(
          JSON.stringify({ full_name: "my-org/repo", default_branch: "main" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const files = await githubScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "my-org/repo",
      fetch: mockFetch,
    });

    // Only the good file should be returned
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe(".checkstack/good.yaml");
  });

  it("uses custom baseUrl for enterprise installations", async () => {
    const enterpriseUrl = "https://github.acme.corp/api/v3";
    const requestedUrls: string[] = [];

    const mockFetch: FetchFn = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);

      if (url.includes("git/trees")) {
        return new Response(
          JSON.stringify({
            sha: "abc",
            tree: [{ path: ".checkstack/sys.yaml", type: "blob" }],
            truncated: false,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("contents/")) {
        return new Response(
          JSON.stringify({ content: btoa("yaml"), encoding: "base64" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("repos/acme/infra")) {
        return new Response(
          JSON.stringify({ full_name: "acme/infra", default_branch: "main" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const files = await githubScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "acme/infra",
      baseUrl: enterpriseUrl,
      fetch: mockFetch,
    });

    expect(files).toHaveLength(1);
    // All requests should use the enterprise URL, not api.github.com
    for (const url of requestedUrls) {
      expect(url).toStartWith(enterpriseUrl);
    }
  });
});
