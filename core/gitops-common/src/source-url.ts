/**
 * Derive a human-browsable source URL for a GitOps-managed entity.
 *
 * Returns null when we don't have enough information to construct a stable URL
 * (e.g., unknown provider type or a malformed `repository` value). Callers
 * should fall back to displaying the raw `repository`/`filePath` text.
 *
 * The URL points at the file on the default branch via the `HEAD` ref so we
 * don't need to know the branch name. Both GitHub and GitLab resolve `HEAD`
 * server-side for blob URLs.
 */
export interface DeriveSourceUrlInput {
  providerType: "github" | "gitlab";
  /** The provider's `baseUrl` (API base) — null for public github.com/gitlab.com. */
  baseUrl: string | null;
  /** GitHub: `owner/repo`. GitLab: `group/project` (or nested `group/sub/project`). */
  repository: string;
  filePath: string;
}

const GITHUB_PUBLIC_HOST = "https://github.com";
const GITLAB_PUBLIC_HOST = "https://gitlab.com";

const stripApiSuffix = ({
  providerType,
  baseUrl,
}: {
  providerType: "github" | "gitlab";
  baseUrl: string;
}): string | null => {
  // We only know how to strip the well-known API path suffixes. Anything else
  // we treat as untrusted and bail out — better to fall back to text than to
  // construct a broken link.
  try {
    const url = new URL(baseUrl);
    if (providerType === "github") {
      // api.github.com → github.com (public host has no API path component)
      if (url.host === "api.github.com") return GITHUB_PUBLIC_HOST;
      // GitHub Enterprise: https://github.example.com/api/v3
      if (url.pathname.replace(/\/$/, "") === "/api/v3") {
        return `${url.protocol}//${url.host}`;
      }
      return null;
    }
    // GitLab: https://gitlab.example.com/api/v4
    if (url.pathname.replace(/\/$/, "") === "/api/v4") {
      return `${url.protocol}//${url.host}`;
    }
    return null;
  } catch {
    return null;
  }
};

const encodeFilePath = (filePath: string) =>
  filePath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const deriveSourceUrl = ({
  providerType,
  baseUrl,
  repository,
  filePath,
}: DeriveSourceUrlInput): string | null => {
  if (!repository || !filePath) return null;
  // Reject backslashes and absolute-looking paths to keep things tidy.
  if (repository.includes("..") || filePath.includes("..")) return null;

  const host = baseUrl
    ? stripApiSuffix({ providerType, baseUrl })
    : providerType === "github"
      ? GITHUB_PUBLIC_HOST
      : GITLAB_PUBLIC_HOST;
  if (!host) return null;

  const repoPath = repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const encodedFile = encodeFilePath(filePath);

  if (providerType === "github") {
    return `${host}/${repoPath}/blob/HEAD/${encodedFile}`;
  }
  return `${host}/${repoPath}/-/blob/HEAD/${encodedFile}`;
};
