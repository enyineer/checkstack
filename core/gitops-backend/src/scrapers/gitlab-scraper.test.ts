import { describe, it, expect } from "bun:test";
import { gitlabScraper } from "./gitlab-scraper";
import type { ScraperOptions, FetchFn } from "./types";
import type { Logger } from "@checkstack/backend-api";

const mockLogger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

const BASE_OPTIONS: Omit<ScraperOptions, "fetch"> = {
  target: "my-group",
  pathPattern: ".checkstack/**/*.yaml",
  authToken: "glpat-test_token",
  logger: mockLogger,
};

/**
 * Creates a mock fetch for GitLab API requests.
 * Uses if/else URL matching to handle overlapping patterns correctly.
 */
function createGitLabMockFetch(config: {
  projects: Array<{
    id: number;
    path_with_namespace: string;
    default_branch: string;
    tree: Array<{ id: string; name: string; type: "blob" | "tree"; path: string }>;
    files: Record<string, string>;
  }>;
  /** If true, the target is treated as a group with multiple projects. */
  groupMode?: boolean;
}): FetchFn {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    // Group projects listing
    if (url.includes("/groups/") && url.includes("/projects")) {
      return new Response(JSON.stringify(config.projects), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check each project
    for (const project of config.projects) {
      // File content (raw)
      const rawFilePattern = `/projects/${project.id}/repository/files/`;
      if (url.includes(rawFilePattern) && url.includes("/raw")) {
        // Extract file path from URL
        const pathMatch = url.match(
          /\/files\/([^/]+)\/raw/,
        );
        if (pathMatch) {
          const decodedPath = decodeURIComponent(pathMatch[1]);
          const content = project.files[decodedPath];
          if (content) {
            return new Response(content, {
              headers: { "Content-Type": "text/plain" },
            });
          }
        }
        return new Response("Not Found", { status: 404 });
      }

      // Repository tree
      const treePattern = `/projects/${project.id}/repository/tree`;
      if (url.includes(treePattern)) {
        return new Response(JSON.stringify(project.tree), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Project metadata (single project mode)
      const encodedPath = encodeURIComponent(project.path_with_namespace);
      if (url.includes(`/projects/${encodedPath}`)) {
        return new Response(JSON.stringify(project), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

describe("gitlabScraper", () => {
  const sampleProject = {
    id: 42,
    path_with_namespace: "my-group/my-project",
    default_branch: "main",
    tree: [
      { id: "a1", name: "systems.yaml", type: "blob" as const, path: ".checkstack/systems.yaml" },
      { id: "a2", name: "README.md", type: "blob" as const, path: "README.md" },
      { id: "a3", name: "src", type: "tree" as const, path: "src" },
    ],
    files: {
      ".checkstack/systems.yaml": "apiVersion: checkstack.io/v1alpha1\nkind: System",
    },
  };

  it("discovers files from a single project target", async () => {
    const mockFetch = createGitLabMockFetch({
      projects: [sampleProject],
    });

    const files = await gitlabScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "my-group/my-project",
      fetch: mockFetch,
    });

    expect(files).toHaveLength(1);
    expect(files[0].repository).toBe("my-group/my-project");
    expect(files[0].filePath).toBe(".checkstack/systems.yaml");
    expect(files[0].content).toContain("checkstack.io/v1alpha1");
    expect(files[0].branch).toBe("main");
  });

  it("enumerates projects from a group target", async () => {
    const mockFetch = createGitLabMockFetch({
      projects: [
        sampleProject,
        {
          id: 43,
          path_with_namespace: "my-group/empty-project",
          default_branch: "develop",
          tree: [],
          files: {},
        },
      ],
      groupMode: true,
    });

    const files = await gitlabScraper.discoverFiles({
      ...BASE_OPTIONS,
      fetch: mockFetch,
    });

    expect(files).toHaveLength(1);
    expect(files[0].repository).toBe("my-group/my-project");
  });

  it("filters files using minimatch pattern", async () => {
    const project = {
      ...sampleProject,
      tree: [
        { id: "a1", name: "systems.yaml", type: "blob" as const, path: ".checkstack/systems.yaml" },
        { id: "a2", name: "nested.yaml", type: "blob" as const, path: ".checkstack/deep/nested.yaml" },
        { id: "a3", name: "file.yaml", type: "blob" as const, path: "other/file.yaml" },
        { id: "a4", name: "readme.md", type: "blob" as const, path: ".checkstack/readme.md" },
      ],
      files: {
        ".checkstack/systems.yaml": "content1",
        ".checkstack/deep/nested.yaml": "content2",
      },
    };

    const mockFetch = createGitLabMockFetch({ projects: [project] });

    const files = await gitlabScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "my-group/my-project",
      fetch: mockFetch,
    });

    expect(files).toHaveLength(2);
    expect(files[0].filePath).toBe(".checkstack/systems.yaml");
    expect(files[1].filePath).toBe(".checkstack/deep/nested.yaml");
  });

  it("handles pagination via x-next-page header", async () => {
    let requestCount = 0;

    const mockFetch: FetchFn = async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/groups/") && url.includes("/projects")) {
        requestCount++;
        if (!url.includes("page=2")) {
          return new Response(
            JSON.stringify([
              { id: 1, path_with_namespace: "g/p1", default_branch: "main" },
            ]),
            {
              headers: {
                "Content-Type": "application/json",
                "x-next-page": "2",
              },
            },
          );
        }
        return new Response(
          JSON.stringify([
            { id: 2, path_with_namespace: "g/p2", default_branch: "main" },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/repository/tree")) {
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    };

    await gitlabScraper.discoverFiles({
      ...BASE_OPTIONS,
      fetch: mockFetch,
    });

    // Should have made 2 requests for projects (page 1 + page 2)
    expect(requestCount).toBe(2);
  });

  it("continues on individual file fetch errors", async () => {
    const project = {
      id: 42,
      path_with_namespace: "my-group/my-project",
      default_branch: "main",
      tree: [
        { id: "a1", name: "good.yaml", type: "blob" as const, path: ".checkstack/good.yaml" },
        { id: "a2", name: "bad.yaml", type: "blob" as const, path: ".checkstack/bad.yaml" },
      ],
      files: {
        ".checkstack/good.yaml": "good-content",
        // bad.yaml deliberately missing from files to simulate error
      },
    };

    const mockFetch = createGitLabMockFetch({ projects: [project] });

    const files = await gitlabScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "my-group/my-project",
      fetch: mockFetch,
    });

    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe(".checkstack/good.yaml");
  });

  it("uses custom baseUrl for self-managed instances", async () => {
    const selfHostedUrl = "https://gitlab.acme.corp/api/v4";
    const requestedUrls: string[] = [];

    const mockFetch: FetchFn = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);

      if (url.includes("/repository/tree")) {
        return new Response(
          JSON.stringify([
            { id: "a1", name: "sys.yaml", type: "blob", path: ".checkstack/sys.yaml" },
          ]),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/repository/files/") && url.includes("/raw")) {
        return new Response("yaml-content", {
          headers: { "Content-Type": "text/plain" },
        });
      }

      if (url.includes("/projects/")) {
        return new Response(
          JSON.stringify({
            id: 99,
            path_with_namespace: "acme/infra",
            default_branch: "main",
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const files = await gitlabScraper.discoverFiles({
      ...BASE_OPTIONS,
      target: "acme/infra",
      baseUrl: selfHostedUrl,
      fetch: mockFetch,
    });

    expect(files).toHaveLength(1);
    // All requests should use the self-hosted URL, not gitlab.com
    for (const url of requestedUrls) {
      expect(url).toStartWith(selfHostedUrl);
    }
  });
});
