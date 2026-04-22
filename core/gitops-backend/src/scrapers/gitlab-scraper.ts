import { minimatch } from "minimatch";
import type { DiscoveredFile, ScraperOptions, Scraper, FetchFn } from "./types";

const DEFAULT_GITLAB_API_URL = "https://gitlab.com/api/v4";

// ─── GitLab API Types ──────────────────────────────────────────────────────

interface GitLabProject {
  id: number;
  path_with_namespace: string;
  default_branch: string;
}

interface GitLabTreeItem {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Makes an authenticated request to the GitLab API.
 */
async function gitlabFetch(params: {
  url: string;
  authToken?: string;
  fetchFn: FetchFn;
}): Promise<Response> {
  const { url, authToken, fetchFn } = params;
  const headers: Record<string, string> = {};
  if (authToken) {
    headers["PRIVATE-TOKEN"] = authToken;
  }
  return fetchFn(url, { headers });
}

/**
 * Paginates through a GitLab API endpoint that uses `x-next-page` header.
 */
async function paginateGitLab<T>(params: {
  initialUrl: string;
  authToken?: string;
  fetchFn: FetchFn;
}): Promise<T[]> {
  const { initialUrl, authToken, fetchFn } = params;
  const results: T[] = [];
  let url: string | undefined = initialUrl;

  while (url) {
    const response = await gitlabFetch({ url, authToken, fetchFn });
    if (!response.ok) {
      throw new Error(
        `GitLab API error: ${response.status} ${response.statusText} (${url})`,
      );
    }

    const data = (await response.json()) as T[];
    results.push(...data);

    const nextPage = response.headers.get("x-next-page");
    if (nextPage && nextPage.trim() !== "") {
      // Build next page URL
      const urlObj: URL = new URL(url);
      urlObj.searchParams.set("page", nextPage);
      url = urlObj.toString();
    } else {
      url = undefined;
    }
  }

  return results;
}

// ─── Core Logic ────────────────────────────────────────────────────────────

/**
 * Enumerates projects for a group target (including subgroups).
 */
async function enumerateProjects(params: {
  target: string;
  authToken?: string;
  fetchFn: FetchFn;
  apiUrl: string;
}): Promise<GitLabProject[]> {
  const { target, authToken, fetchFn, apiUrl } = params;
  const encodedTarget = encodeURIComponent(target);
  const url = `${apiUrl}/groups/${encodedTarget}/projects?include_subgroups=true&per_page=100`;
  return paginateGitLab<GitLabProject>({ initialUrl: url, authToken, fetchFn });
}

/**
 * Gets the file tree for a project and filters paths using minimatch.
 */
async function getMatchingFiles(params: {
  project: GitLabProject;
  pathPattern: string;
  authToken?: string;
  fetchFn: FetchFn;
  apiUrl: string;
}): Promise<string[]> {
  const { project, pathPattern, authToken, fetchFn, apiUrl } = params;

  const url = `${apiUrl}/projects/${project.id}/repository/tree?recursive=true&ref=${encodeURIComponent(project.default_branch)}&per_page=100`;
  const items = await paginateGitLab<GitLabTreeItem>({
    initialUrl: url,
    authToken,
    fetchFn,
  });

  return items
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((path) => minimatch(path, pathPattern));
}

/**
 * Fetches the raw content of a file from a GitLab project.
 */
async function fetchFileContent(params: {
  projectId: number;
  filePath: string;
  branch: string;
  authToken?: string;
  fetchFn: FetchFn;
  apiUrl: string;
}): Promise<string> {
  const { projectId, filePath, branch, authToken, fetchFn, apiUrl } = params;
  const encodedPath = encodeURIComponent(filePath);
  const url = `${apiUrl}/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(branch)}`;
  const response = await gitlabFetch({ url, authToken, fetchFn });

  if (!response.ok) {
    throw new Error(
      `GitLab API error fetching ${filePath} from project ${projectId}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

// ─── Scraper ───────────────────────────────────────────────────────────────

/**
 * GitLab scraper implementation.
 *
 * Supports:
 * - Group target: enumerates all projects including subgroups with pagination
 * - Single project target: `group/project` format
 * - Default branch resolution per-project
 * - Recursive tree walking with minimatch filtering
 * - Custom base URL for self-managed GitLab instances
 */
export const gitlabScraper: Scraper = {
  async discoverFiles(options: ScraperOptions): Promise<DiscoveredFile[]> {
    const {
      target,
      pathPattern,
      authToken,
      baseUrl,
      logger,
      fetch: fetchFn = globalThis.fetch,
    } = options;

    const apiUrl = baseUrl ?? DEFAULT_GITLAB_API_URL;
    const isSingleProject = target.includes("/");
    const files: DiscoveredFile[] = [];

    let projects: GitLabProject[];

    if (isSingleProject) {
      // Single project mode: fetch project metadata directly
      const encodedTarget = encodeURIComponent(target);
      const url = `${apiUrl}/projects/${encodedTarget}`;
      const response = await gitlabFetch({ url, authToken, fetchFn });
      if (!response.ok) {
        throw new Error(
          `GitLab API error fetching project ${target}: ${response.status} ${response.statusText}`,
        );
      }
      projects = [(await response.json()) as GitLabProject];
    } else {
      projects = await enumerateProjects({
        target,
        authToken,
        fetchFn,
        apiUrl,
      });
    }

    logger.debug(
      `GitLab scraper: found ${projects.length} project(s) for target "${target}"`,
    );

    for (const project of projects) {
      try {
        const matchingPaths = await getMatchingFiles({
          project,
          pathPattern,
          authToken,
          fetchFn,
          apiUrl,
        });

        logger.debug(
          `GitLab scraper: ${matchingPaths.length} matching file(s) in ${project.path_with_namespace}`,
        );

        for (const filePath of matchingPaths) {
          try {
            const content = await fetchFileContent({
              projectId: project.id,
              filePath,
              branch: project.default_branch,
              authToken,
              fetchFn,
              apiUrl,
            });

            files.push({
              repository: project.path_with_namespace,
              filePath,
              content,
              branch: project.default_branch,
            });
          } catch (error) {
            logger.error(
              `GitLab scraper: failed to fetch ${filePath} from ${project.path_with_namespace}: ${error}`,
            );
          }
        }
      } catch (error) {
        logger.error(
          `GitLab scraper: failed to process project ${project.path_with_namespace}: ${error}`,
        );
      }
    }

    return files;
  },
};
