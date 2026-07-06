import { describe, expect, test } from "bun:test";
import type { AuthService, AuthUser, Logger } from "@checkstack/backend-api";
import {
  buildSdkTypesPath,
  scriptPackagesAccess,
  SDK_TYPES_PATH_PREFIX,
} from "@checkstack/script-packages-common";
import {
  createSdkTypesHttpHandler,
  SDK_BUNDLE_VIRTUAL_PATH,
} from "./sdk-types-route";

const RELEASE_VERSION = "0.93.0";
const BUNDLE = 'declare module "@checkstack/sdk/healthcheck" {}\n';

/** No-op logger satisfying the Logger interface. */
const logger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

/** Build an AuthService stub that authenticates to the given user. Only
 * `authenticate` is exercised by the handler; the rest of the AuthService
 * surface is irrelevant here, so we narrow through `unknown`. */
function authStub(user: AuthUser | undefined): AuthService {
  const stub: Pick<AuthService, "authenticate"> = {
    authenticate: async () => user,
  };
  return stub as unknown as AuthService;
}

/** A reader user holding the global `script-packages.read` rule. */
const readerUser: AuthUser = {
  type: "application",
  id: "app-1",
  name: "tester",
  accessRules: [scriptPackagesAccess.read.id],
};

function makeHandler(auth: AuthService) {
  return createSdkTypesHttpHandler({
    auth,
    getReleaseVersion: () => RELEASE_VERSION,
    getSdkBundle: () => BUNDLE,
    logger,
  });
}

function request(version: string, method = "GET"): Request {
  const path = buildSdkTypesPath({ releaseVersion: version });
  return new Request(`https://host/api/script-packages${path}`, { method });
}

describe("createSdkTypesHttpHandler", () => {
  test("matching version returns 200 + immutable cache header + bundle", async () => {
    const res = await makeHandler(authStub(readerUser))(
      request(RELEASE_VERSION),
    );
    expect(res.status).toBe(200);
    const cache = res.headers.get("Cache-Control") ?? "";
    expect(cache).toContain("private");
    expect(cache).toContain("immutable");
    expect(cache).toContain("max-age=");
    const body = (await res.json()) as {
      files: { path: string; content: string }[];
    };
    expect(body.files).toHaveLength(1);
    expect(body.files[0]?.path).toBe(SDK_BUNDLE_VIRTUAL_PATH);
    expect(body.files[0]?.content).toBe(BUNDLE);
  });

  test("mismatched version returns 409 (stale, not cached)", async () => {
    const res = await makeHandler(authStub(readerUser))(request("0.0.1"));
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBeNull();
  });

  test("unauthenticated returns 401", async () => {
    const res = await makeHandler(authStub(undefined))(
      request(RELEASE_VERSION),
    );
    expect(res.status).toBe(401);
  });

  test("any authenticated user is allowed (no script-packages.read needed)", async () => {
    // The SDK editor bundle is IntelliSense type data, not secrets. Any logged-in
    // user - e.g. a team-scoped health-check manager authoring a script collector
    // without the global script-packages.read grant - may fetch it.
    const noAccess: AuthUser = {
      type: "application",
      id: "app-2",
      name: "no-access",
      accessRules: [],
    };
    const res = await makeHandler(authStub(noAccess))(request(RELEASE_VERSION));
    expect(res.status).toBe(200);
  });

  test("a service user is trusted (200)", async () => {
    const service: AuthUser = { type: "service", pluginId: "svc" };
    const res = await makeHandler(authStub(service))(request(RELEASE_VERSION));
    expect(res.status).toBe(200);
  });

  test("non-GET method returns 405", async () => {
    const res = await makeHandler(authStub(readerUser))(
      request(RELEASE_VERSION, "POST"),
    );
    expect(res.status).toBe(405);
  });

  test("a wildcard access rule grants read", async () => {
    const wildcard: AuthUser = {
      type: "application",
      id: "app-3",
      name: "wild",
      accessRules: ["*"],
    };
    const res = await makeHandler(authStub(wildcard))(request(RELEASE_VERSION));
    expect(res.status).toBe(200);
  });
});
