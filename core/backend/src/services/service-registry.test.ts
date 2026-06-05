import { describe, it, expect } from "bun:test";
import { createServiceRef } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import { ServiceRegistry } from "./service-registry";

const metadata: PluginMetadata = { pluginId: "core" };

describe("ServiceRegistry resolution precedence", () => {
  it("resolves a factory before a plain instance for the same ref", async () => {
    const ref = createServiceRef<string>("test.svc");
    const registry = new ServiceRegistry();
    registry.register(ref, "instance");
    registry.registerFactory(ref, () => "factory");
    // get() tries factories first — this is the long-standing behaviour the
    // dev-auth fix relies on (see below).
    expect(await registry.get(ref, metadata)).toBe("factory");
  });

  it("returns the registered instance when no factory exists", async () => {
    const ref = createServiceRef<string>("test.svc.instance-only");
    const registry = new ServiceRegistry();
    registry.register(ref, "instance");
    expect(await registry.get(ref, metadata)).toBe("instance");
  });

  // Regression guard (#251): the CHECKSTACK_DEV_AUTH bypass was dead code on
  // the API path because the production auth FACTORY (registered by
  // `registerCoreServices`) shadowed a dev auth INSTANCE registered via
  // `registerService(coreServices.auth, …)` — `get()` resolves factories
  // before instances, so the dev auth was never returned and every plugin
  // API request 401ed. The fix registers the dev auth as a FACTORY so it
  // wins. This test models that exact wiring on the auth ref.
  it("dev auth registered as a factory overrides a pre-existing production auth factory", async () => {
    const authRef = createServiceRef<{ kind: string }>("checkstack.auth");
    const registry = new ServiceRegistry();

    // Production setup: real auth registered as a factory.
    const prodAuth = { kind: "production" };
    registry.registerFactory(authRef, () => prodAuth);

    // Sanity: before the dev override, get() returns the production factory.
    expect((await registry.get(authRef, metadata)).kind).toBe("production");

    // Dev path: register dev auth as a factory (NOT a plain instance).
    const devAuth = { kind: "dev" };
    registry.registerFactory(authRef, () => devAuth);

    // The dev auth must now be what get() returns.
    expect((await registry.get(authRef, metadata)).kind).toBe("dev");
  });

  it("a dev auth registered as a plain instance is (still) shadowed by a factory — documents why the fix uses a factory", async () => {
    const authRef = createServiceRef<{ kind: string }>("checkstack.auth.legacy");
    const registry = new ServiceRegistry();
    registry.registerFactory(authRef, () => ({ kind: "production" }));
    // This is the BUGGY shape the fix replaced: an instance is shadowed.
    registry.register(authRef, { kind: "dev" });
    expect((await registry.get(authRef, metadata)).kind).toBe("production");
  });
});
