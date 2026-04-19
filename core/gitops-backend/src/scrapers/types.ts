import type { Logger } from "@checkstack/backend-api";

/**
 * A fetch function compatible with the standard Fetch API.
 * We use a custom type alias instead of `typeof globalThis.fetch` because Bun's
 * native fetch includes a non-standard `preconnect` method that breaks mock implementations.
 */
export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * A file discovered by a scraper from a Git provider.
 */
export interface DiscoveredFile {
  /** Full repository identifier (e.g., "my-org/my-repo"). */
  repository: string;
  /** Path to the file within the repository. */
  filePath: string;
  /** Raw file content (decoded from base64 if needed). */
  content: string;
  /** The branch the file was read from. */
  branch: string;
}

/**
 * Options passed to a scraper's discoverFiles method.
 */
export interface ScraperOptions {
  /** Target: org/user name or "owner/repo" for single-repo mode. */
  target: string;
  /** Glob pattern for matching file paths (e.g., ".checkstack/**\/*.yaml"). */
  pathPattern: string;
  /** Decrypted auth token for the Git provider API. */
  authToken: string;
  /** Custom API base URL for enterprise/on-prem installations. */
  baseUrl?: string;
  /** Logger for diagnostic output. */
  logger: Logger;
  /** Optional fetch override (defaults to global fetch). Used for testing. */
  fetch?: FetchFn;
}

/**
 * Interface for Git provider scrapers.
 * Each provider type (GitHub, GitLab) implements this interface.
 */
export interface Scraper {
  /** Discover all YAML descriptor files matching the configured path pattern. */
  discoverFiles(options: ScraperOptions): Promise<DiscoveredFile[]>;
}
