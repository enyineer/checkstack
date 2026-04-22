import { minimatch } from "minimatch";
import type { DiscoveredFile, ScraperOptions, Scraper, FetchFn } from "./types";

const DEFAULT_GITHUB_API_URL = "https://api.github.com";

// ─── GitHub API Types ──────────────────────────────────────────────────────

interface GitHubRepo {
  full_name: string;
  default_branch: string;
}

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
}

interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

interface GitHubContentResponse {
  content: string;
  encoding: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parses the GitHub `Link` header for pagination.
 * Returns the URL for the next page, or undefined if there is none.
 */
function parseNextPageUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  return match?.[1];
}

/**
 * Makes an authenticated request to the GitHub API.
 */
async function githubFetch(params: {
  url: string;
  authToken?: string;
  fetchFn: FetchFn;
}): Promise<Response> {
  const { url, authToken, fetchFn } = params;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return fetchFn(url, { headers });
}

// ─── Core Logic ────────────────────────────────────────────────────────────

/**
 * Enumerates repositories for an org or user target.
 * Supports pagination via Link header.
 */
async function enumerateRepos(params: {
  target: string;
  authToken?: string;
  fetchFn: FetchFn;
  apiUrl: string;
}): Promise<GitHubRepo[]> {
  const { target, authToken, fetchFn, apiUrl } = params;
  const repos: GitHubRepo[] = [];

  // Try org endpoint first, fall back to user endpoint
  let url: string | undefined =
    `${apiUrl}/orgs/${encodeURIComponent(target)}/repos?per_page=100`;

  const orgResponse = await githubFetch({ url, authToken, fetchFn });

  if (orgResponse.status === 404) {
    // Fall back to user endpoint
    url = `${apiUrl}/users/${encodeURIComponent(target)}/repos?per_page=100`;
  } else if (orgResponse.ok) {
    const data = (await orgResponse.json()) as GitHubRepo[];
    repos.push(...data);
    url = parseNextPageUrl(orgResponse.headers.get("Link"));
  } else {
    throw new Error(
      `GitHub API error listing org repos: ${orgResponse.status} ${orgResponse.statusText}`,
    );
  }

  // Paginate through remaining pages (or user repos if org 404'd)
  while (url) {
    const response = await githubFetch({ url, authToken, fetchFn });
    if (!response.ok) {
      throw new Error(
        `GitHub API error listing repos: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as GitHubRepo[];
    repos.push(...data);
    url = parseNextPageUrl(response.headers.get("Link"));
  }

  return repos;
}

/**
 * Gets the file tree for a repository using the Git Trees API.
 * Returns only blob (file) paths matching the path pattern.
 */
async function getMatchingFiles(params: {
  repo: GitHubRepo;
  pathPattern: string;
  authToken?: string;
  fetchFn: FetchFn;
  apiUrl: string;
}): Promise<string[]> {
  const { repo, pathPattern, authToken, fetchFn, apiUrl } = params;

  const url = `${apiUrl}/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`;
  const response = await githubFetch({ url, authToken, fetchFn });

  if (!response.ok) {
    throw new Error(
      `GitHub API error getting tree for ${repo.full_name}: ${response.status} ${response.statusText}`,
    );
  }

  const tree = (await response.json()) as GitHubTreeResponse;

  return tree.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((path) => minimatch(path, pathPattern));
}

/**
 * Fetches the content of a single file from a repository.
 */
async function fetchFileContent(params: {
  repoFullName: string;
  filePath: string;
  branch: string;
  authToken?: string;
  fetchFn: FetchFn;
  apiUrl: string;
}): Promise<string> {
  const { repoFullName, filePath, branch, authToken, fetchFn, apiUrl } = params;

  const url = `${apiUrl}/repos/${repoFullName}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`;
  const response = await githubFetch({ url, authToken, fetchFn });

  if (!response.ok) {
    throw new Error(
      `GitHub API error fetching ${filePath} from ${repoFullName}: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as GitHubContentResponse;

  if (data.encoding === "base64") {
    return atob(data.content.replaceAll("\n", ""));
  }

  return data.content;
}

// ─── Scraper ───────────────────────────────────────────────────────────────

/**
 * GitHub scraper implementation.
 *
 * Supports:
 * - Org/user target: enumerates all repos with pagination
 * - Single repo target: `owner/repo` format
 * - Default branch resolution per-repo
 * - Recursive tree walking with minimatch filtering
 * - Custom base URL for GitHub Enterprise
 */
export const githubScraper: Scraper = {
  async discoverFiles(options: ScraperOptions): Promise<DiscoveredFile[]> {
    const {
      target,
      pathPattern,
      authToken,
      baseUrl,
      logger,
      fetch: fetchFn = globalThis.fetch,
    } = options;

    const apiUrl = baseUrl ?? DEFAULT_GITHUB_API_URL;
    const isSingleRepo = target.includes("/");
    const files: DiscoveredFile[] = [];

    let repos: GitHubRepo[];

    if (isSingleRepo) {
      // Single repo mode: fetch repo metadata directly
      const url = `${apiUrl}/repos/${target}`;
      const response = await githubFetch({ url, authToken, fetchFn });
      if (!response.ok) {
        throw new Error(
          `GitHub API error fetching repo ${target}: ${response.status} ${response.statusText}`,
        );
      }
      repos = [(await response.json()) as GitHubRepo];
    } else {
      repos = await enumerateRepos({ target, authToken, fetchFn, apiUrl });
    }

    logger.debug(
      `GitHub scraper: found ${repos.length} repo(s) for target "${target}"`,
    );

    for (const repo of repos) {
      try {
        const matchingPaths = await getMatchingFiles({
          repo,
          pathPattern,
          authToken,
          fetchFn,
          apiUrl,
        });

        logger.debug(
          `GitHub scraper: ${matchingPaths.length} matching file(s) in ${repo.full_name}`,
        );

        for (const filePath of matchingPaths) {
          try {
            const content = await fetchFileContent({
              repoFullName: repo.full_name,
              filePath,
              branch: repo.default_branch,
              authToken,
              fetchFn,
              apiUrl,
            });

            files.push({
              repository: repo.full_name,
              filePath,
              content,
              branch: repo.default_branch,
            });
          } catch (error) {
            logger.error(
              `GitHub scraper: failed to fetch ${filePath} from ${repo.full_name}: ${error}`,
            );
          }
        }
      } catch (error) {
        logger.error(
          `GitHub scraper: failed to process repo ${repo.full_name}: ${error}`,
        );
      }
    }

    return files;
  },
};
