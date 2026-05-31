import path from "node:path";
import type { AuthService, Logger } from "@checkstack/backend-api";
import {
  parseTypeAcquisitionPath,
  scriptPackagesAccess,
  TYPE_ACQUISITION_PATH_PREFIX,
  type PackageTypeClosure,
} from "@checkstack/script-packages-common";
import { extractErrorMessage } from "@checkstack/common";
import { resolvePackageTypeClosure } from "./package-types";
import { storePaths } from "./data-dir";

/**
 * Raw, HTTP-cacheable route serving one package's `.d.ts` closure for editor
 * lazy ATA. Mounted (via `rpc.registerHttpHandler`) at
 * `/api/script-packages/types/:lockfileHash/:encodedSpecifier`.
 *
 * Why a raw route and not an oRPC procedure: oRPC responses in this codebase
 * cannot set custom HTTP response headers (the Hono `/api` handler builds the
 * RpcContext WITHOUT a `responseHeaders` bag, so a procedure can't emit
 * `Cache-Control`). The user explicitly wants HTTP-level caching keyed to the
 * install, so we serve a raw handler and set the headers directly.
 *
 * Caching: the path carries the current `lockfileHash`, and the response sets
 * `Cache-Control: private, max-age=<1y>, immutable`. A given (hash, specifier)
 * closure is immutable for the life of that install; a new install changes the
 * hash, so the browser simply requests a fresh URL and never reuses the old
 * cache entry. `private` because the registry (and thus the types) may be
 * private.
 *
 * Auth: this is a raw route, so it bypasses the oRPC auto-auth middleware. We
 * authenticate the request and enforce the same global `script-packages.read`
 * access the (removed) oRPC procedure used. The resource has no instance-level
 * access, so a global-access check is exactly equivalent.
 */

/** One year. The (hash, specifier) closure is immutable for the install. */
const CACHE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

interface CreateTypeClosureHttpHandlerDeps {
  auth: AuthService;
  /** Returns the current desired lockfile hash (null = no packages). */
  getLockfileHash: () => Promise<string | null>;
  storeRoot: string;
  logger: Logger;
}

/**
 * Whether the authenticated user holds global `script-packages.read`.
 * Services are trusted; users/applications must carry the rule (or `*`).
 */
function hasReadAccess(
  user: Awaited<ReturnType<AuthService["authenticate"]>>,
): boolean {
  if (!user) return false;
  if (user.type === "service") return true;
  const rules = user.accessRules ?? [];
  return (
    rules.includes("*") || rules.includes(scriptPackagesAccess.read.id)
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function createTypeClosureHttpHandler({
  auth,
  getLockfileHash,
  storeRoot,
  logger,
}: CreateTypeClosureHttpHandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // ─── Auth ─────────────────────────────────────────────────────────────
    let user: Awaited<ReturnType<AuthService["authenticate"]>>;
    try {
      user = await auth.authenticate(req);
    } catch (error) {
      logger.error(
        `Type-closure auth failed: ${extractErrorMessage(error)}`,
      );
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
    if (!hasReadAccess(user)) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    // ─── Parse path ───────────────────────────────────────────────────────
    const pathname = new URL(req.url).pathname;
    const prefixIndex = pathname.indexOf(TYPE_ACQUISITION_PATH_PREFIX);
    if (prefixIndex === -1) {
      return jsonResponse({ error: "Not found" }, 404);
    }
    const afterPrefix = pathname.slice(
      prefixIndex + TYPE_ACQUISITION_PATH_PREFIX.length,
    );
    const parsed = parseTypeAcquisitionPath(afterPrefix);
    if (!parsed) {
      return jsonResponse({ error: "Bad request" }, 400);
    }
    const { lockfileHash, specifier } = parsed;

    // ─── Hash must match the current install ──────────────────────────────
    // We only retain the current materialized tree; an old hash's tree may be
    // gone. A mismatch means the client's install state is stale — tell it so
    // it refetches install state and retries against the new hash.
    let currentHash: string | null;
    try {
      currentHash = await getLockfileHash();
    } catch (error) {
      logger.error(
        `Type-closure install-state load failed: ${extractErrorMessage(error)}`,
      );
      return jsonResponse({ error: "Internal error" }, 500);
    }
    if (currentHash === null) {
      // No packages configured: nothing to acquire. Cacheable empty result.
      return cacheableClosure({
        specifier,
        files: [],
        hasOwnTypes: false,
        hasAtTypes: false,
        notFound: true,
        truncated: false,
      });
    }
    if (currentHash !== lockfileHash) {
      // Don't cache a stale-hash miss (no immutable guarantee).
      return jsonResponse(
        { error: "Stale lockfile hash; refetch install state." },
        409,
      );
    }

    // ─── Resolve the closure off the materialized tree ────────────────────
    const nodeModulesDir = path.join(
      storePaths(storeRoot).trees,
      lockfileHash,
      "node_modules",
    );
    let closure: PackageTypeClosure;
    try {
      closure = await resolvePackageTypeClosure({
        nodeModulesDir,
        specifier,
      });
    } catch (error) {
      logger.error(
        `Type-closure resolution failed for "${specifier}": ${extractErrorMessage(
          error,
        )}`,
      );
      return jsonResponse({ error: "Internal error" }, 500);
    }
    if (closure.truncated) {
      logger.warn(
        `Type closure for "${specifier}" (${lockfileHash}) hit the size ceiling; some declarations were dropped.`,
      );
    }
    return cacheableClosure(closure);
  };
}

function cacheableClosure(closure: PackageTypeClosure): Response {
  return Response.json(closure, {
    status: 200,
    headers: {
      // Per-install immutable: the (hash, specifier) closure never changes
      // for the life of the install. `private` because types may be private.
      "Cache-Control": `private, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`,
    },
  });
}
