import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  searchPackages,
  getPackageVersions,
  registryUrlForName,
  RegistryClientError,
  type PackageSearchResult,
} from "./registry-client";
import type { RegistryRequestConfig } from "./registry-request-config";

const npmRegistry: RegistryRequestConfig = {
  registryUrl: "https://registry.npmjs.org/",
  scopedRegistries: [],
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Read a header from the recorded `RequestInit` without a type cast: the
 * client always passes a plain object of string headers, so narrow `unknown`
 * with zod rather than asserting the type.
 */
function headerValue(init: RequestInit | undefined, key: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(key) ?? undefined;
  if (Array.isArray(headers)) {
    return headers.find(([k]) => k === key)?.[1];
  }
  const value: unknown = headers[key];
  return typeof value === "string" ? value : undefined;
}

/** Install a fetch mock that records calls and returns a JSON body. */
function mockFetch(
  handler: (url: string, init?: RequestInit) => {
    ok?: boolean;
    status?: number;
    json: unknown;
  } | Promise<never>,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const result = await handler(url, init);
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      json: async () => result.json,
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe("searchPackages", () => {
  test("maps objects[].package to name/version/description", async () => {
    mockFetch(() => ({
      json: {
        objects: [
          { package: { name: "lodash", version: "4.17.21", description: "utils" } },
          { package: { name: "lodash-es", version: "4.17.21" } },
        ],
      },
    }));
    const items = await searchPackages({
      registry: npmRegistry,
      text: "lodash",
      now: 1,
    });
    expect(items).toEqual([
      { name: "lodash", version: "4.17.21", description: "utils" },
      { name: "lodash-es", version: "4.17.21", description: undefined },
    ]);
  });

  test("hits the -/v1/search endpoint and caps size at 25", async () => {
    const calls = mockFetch(() => ({ json: { objects: [] } }));
    await searchPackages({
      registry: npmRegistry,
      text: "react",
      size: 1000,
      now: 1,
    });
    expect(calls[0].url).toBe(
      "https://registry.npmjs.org/-/v1/search?text=react&size=25",
    );
  });

  test("does NOT send Authorization when no token", async () => {
    const calls = mockFetch(() => ({ json: { objects: [] } }));
    await searchPackages({ registry: npmRegistry, text: "no-auth", now: 1 });
    expect(headerValue(calls[0].init, "authorization")).toBeUndefined();
  });

  test("sends Authorization: Bearer when a token is set", async () => {
    const calls = mockFetch(() => ({ json: { objects: [] } }));
    await searchPackages({
      registry: { ...npmRegistry, authToken: "s3cret" },
      text: "with-auth",
      now: 1,
    });
    expect(headerValue(calls[0].init, "authorization")).toBe("Bearer s3cret");
  });

  test("non-200 → RegistryClientError without the token", async () => {
    mockFetch(() => ({ ok: false, status: 503, json: {} }));
    const promise = searchPackages({
      registry: { ...npmRegistry, authToken: "TOPSECRET" },
      text: "non-200-case",
      now: 1,
    });
    await expect(promise).rejects.toBeInstanceOf(RegistryClientError);
    await promise.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("TOPSECRET");
    });
  });

  test("timeout (abort) → RegistryClientError without the token", async () => {
    // Honor the AbortController: reject only once the signal fires, exactly
    // as a real timed-out fetch would, so the client sees `signal.aborted`.
    globalThis.fetch = mock(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ) as unknown as typeof fetch;
    const promise = searchPackages({
      registry: { ...npmRegistry, authToken: "TOPSECRET" },
      text: "abort-case",
      now: 1,
      timeoutMs: 5,
    });
    await expect(promise).rejects.toBeInstanceOf(RegistryClientError);
    await promise.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("timed out");
      expect(message).not.toContain("TOPSECRET");
    });
  });

  test("cache returns within TTL, refetches after it expires", async () => {
    let hits = 0;
    mockFetch(() => {
      hits += 1;
      return {
        json: {
          objects: [{ package: { name: `pkg-${hits}`, version: "1.0.0" } }],
        },
      };
    });
    const a = await searchPackages({
      registry: npmRegistry,
      text: "cache-me",
      now: 1000,
    });
    const b = await searchPackages({
      registry: npmRegistry,
      text: "cache-me",
      now: 2000,
    });
    expect(hits).toBe(1);
    expect(b).toEqual(a);

    // Past the 45s TTL → refetch.
    const c = await searchPackages({
      registry: npmRegistry,
      text: "cache-me",
      now: 1000 + 46_000,
    });
    expect(hits).toBe(2);
    expect(c).not.toEqual(a);
  });
});

describe("getPackageVersions", () => {
  test("returns versions newest-first and parses dist-tags", async () => {
    mockFetch(() => ({
      json: {
        versions: {
          "1.0.0": {},
          "1.2.0": {},
          "1.10.0": {},
          "2.0.0-rc.1": {},
        },
        "dist-tags": { latest: "1.10.0", next: "2.0.0-rc.1" },
      },
    }));
    const result = await getPackageVersions({
      registry: npmRegistry,
      name: "lodash",
      now: 1,
    });
    expect(result.versions).toEqual([
      "2.0.0-rc.1",
      "1.10.0",
      "1.2.0",
      "1.0.0",
    ]);
    expect(result.distTags).toEqual({ latest: "1.10.0", next: "2.0.0-rc.1" });
  });

  test("a release outranks its prerelease of the same core version", async () => {
    mockFetch(() => ({
      json: {
        versions: { "2.0.0": {}, "2.0.0-rc.1": {} },
        "dist-tags": {},
      },
    }));
    const result = await getPackageVersions({
      registry: npmRegistry,
      name: "release-vs-pre",
      now: 1,
    });
    expect(result.versions).toEqual(["2.0.0", "2.0.0-rc.1"]);
    expect(result.distTags).toBeUndefined();
  });

  test("tolerates an odd version string instead of discarding the response", async () => {
    mockFetch(() => ({
      json: {
        versions: { "1.0.0": {}, latest: {}, "2.0.0": {} },
        "dist-tags": {},
      },
    }));
    const result = await getPackageVersions({
      registry: npmRegistry,
      name: "odd-version",
      now: 1,
    });
    // Parseable versions first (desc), the odd one ("latest") sorted last.
    expect(result.versions).toEqual(["2.0.0", "1.0.0", "latest"]);
  });

  test("encodes a scoped name and selects its scoped registry", async () => {
    const calls = mockFetch(() => ({
      json: { versions: { "1.0.0": {} }, "dist-tags": {} },
    }));
    await getPackageVersions({
      registry: {
        registryUrl: "https://registry.npmjs.org/",
        scopedRegistries: [
          { scope: "@acme", registryUrl: "https://npm.acme.com/" },
        ],
      },
      name: "@acme/utils",
      now: 1,
    });
    expect(calls[0].url).toBe("https://npm.acme.com/@acme%2Futils");
  });

  test("falls back to the base registry for an unmatched scope", async () => {
    const calls = mockFetch(() => ({
      json: { versions: { "1.0.0": {} }, "dist-tags": {} },
    }));
    await getPackageVersions({
      registry: npmRegistry,
      name: "@other/thing",
      now: 1,
    });
    expect(calls[0].url).toBe(
      "https://registry.npmjs.org/@other%2Fthing",
    );
  });

  test("caches versions within the TTL keyed by registry+name", async () => {
    let hits = 0;
    mockFetch(() => {
      hits += 1;
      return { json: { versions: { "1.0.0": {} }, "dist-tags": {} } };
    });
    await getPackageVersions({ registry: npmRegistry, name: "cached-pkg", now: 5000 });
    await getPackageVersions({ registry: npmRegistry, name: "cached-pkg", now: 6000 });
    expect(hits).toBe(1);
    await getPackageVersions({
      registry: npmRegistry,
      name: "cached-pkg",
      now: 5000 + 46_000,
    });
    expect(hits).toBe(2);
  });
});

describe("registryUrlForName", () => {
  test("unscoped name uses the base registry", () => {
    expect(
      registryUrlForName({ name: "lodash", registry: npmRegistry }),
    ).toBe("https://registry.npmjs.org/");
  });

  test("scoped name uses a matching scoped registry", () => {
    const url = registryUrlForName({
      name: "@acme/x",
      registry: {
        ...npmRegistry,
        scopedRegistries: [
          { scope: "@acme", registryUrl: "https://npm.acme.com/" },
        ],
      },
    });
    expect(url).toBe("https://npm.acme.com/");
  });
});

// Type-level guard: the exported result shape stays mappable.
const _typeCheck: PackageSearchResult = { name: "x" };
void _typeCheck;
