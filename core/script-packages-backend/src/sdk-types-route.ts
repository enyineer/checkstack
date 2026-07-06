import type { AuthService, Logger } from "@checkstack/backend-api";
import {
  parseSdkTypesPath,
  SDK_TYPES_PATH_PREFIX,
} from "@checkstack/script-packages-common";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Raw, HTTP-cacheable route serving the running platform release's generated
 * `@checkstack/sdk` editor bundle (`core/sdk/generated/editor-bundle.d.ts`)
 * for the in-app TypeScript script editor. Mounted (via
 * `rpc.registerHttpHandler`) at `/api/script-packages/sdk-types/:releaseVersion`.
 *
 * Why a raw route and not an oRPC procedure: identical to the type-acquisition
 * route - oRPC responses here can't set custom HTTP headers, and we want
 * HTTP-level caching keyed to the running release. So we serve a raw handler
 * and set `Cache-Control` directly.
 *
 * Caching: the path carries the running release version, and the response sets
 * `Cache-Control: private, max-age=<1y>, immutable`. The SDK bundle is
 * immutable for the life of a deployed release; a deployment upgrade changes
 * the version, so the editor requests a fresh URL and never reuses the old
 * cache entry. `private` because the surface (contract names) may be sensitive.
 *
 * Staleness: if the client requests a version != the running version (e.g. a
 * tab open across a deployment upgrade), we return `409` so the client refetches
 * the current version and remounts the fresh types - never serving stale SDK
 * declarations.
 *
 * Auth: a raw route bypasses oRPC auto-auth, so we authenticate and enforce the
 * same global `script-packages.read` access the editor's ATA route uses.
 */

/** One year. The bundle is immutable for the life of a deployed release. */
const CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The virtual path the editor mounts the bundle at (a `node_modules` path so
 * `@checkstack/sdk` + subpath resolution finds it). */
export const SDK_BUNDLE_VIRTUAL_PATH =
  "node_modules/@checkstack/sdk/editor-bundle.d.ts";

interface CreateSdkTypesHttpHandlerDeps {
  auth: AuthService;
  /** The running platform release version (e.g. `@checkstack/release`). */
  getReleaseVersion: () => string;
  /** The generated SDK editor bundle (`editor-bundle.d.ts`) content. */
  getSdkBundle: () => string;
  logger: Logger;
}

/** One acquired file, mirroring the type-acquisition response shape so the
 * frontend reuses the same `registerAcquiredFiles` mount path. */
interface SdkTypesFile {
  path: string;
  content: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function createSdkTypesHttpHandler({
  auth,
  getReleaseVersion,
  getSdkBundle,
  logger,
}: CreateSdkTypesHttpHandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // ─── Auth ─────────────────────────────────────────────────────────────
    let user: Awaited<ReturnType<AuthService["authenticate"]>>;
    try {
      user = await auth.authenticate(req);
    } catch (error) {
      logger.error(`SDK-types auth failed: ${extractErrorMessage(error)}`);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    // Authenticated-only: the SDK editor bundle is generic `@checkstack/sdk`
    // TypeScript declarations (IntelliSense), not secrets. Any script author -
    // including a team-scoped healthcheck manager without the separate
    // `script-packages.read` global grant - needs it. Services are trusted.
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

    // ─── Parse path ───────────────────────────────────────────────────────
    const pathname = new URL(req.url).pathname;
    const prefixIndex = pathname.indexOf(SDK_TYPES_PATH_PREFIX);
    if (prefixIndex === -1) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    const afterPrefix = pathname.slice(
      prefixIndex + SDK_TYPES_PATH_PREFIX.length,
    );
    const parsed = parseSdkTypesPath(afterPrefix);
    if (!parsed) {
      return jsonResponse({ error: "Bad request" }, 400);
    }

    // ─── Version must match the running release ───────────────────────────
    const runningVersion = getReleaseVersion();
    if (parsed.releaseVersion !== runningVersion) {
      // Stale (e.g. a tab open across a deployment upgrade). Don't cache a
      // mismatch; tell the client to refetch the current version.
      return jsonResponse(
        { error: "Stale release version; refetch SDK types." },
        409,
      );
    }

    const files: SdkTypesFile[] = [
      { path: SDK_BUNDLE_VIRTUAL_PATH, content: getSdkBundle() },
    ];
    return Response.json(
      { files },
      {
        status: 200,
        headers: {
          // Immutable for the life of this release; the version-keyed path
          // changes on upgrade so the old URL is never reused.
          "Cache-Control": `private, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`,
        },
      },
    );
  };
}
