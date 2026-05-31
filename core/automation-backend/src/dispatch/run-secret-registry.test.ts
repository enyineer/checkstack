import { describe, it, expect } from "bun:test";
import type { ServiceRef } from "@checkstack/backend-api";
import {
  createRunSecretRegistry,
  wrapGetServiceForRun,
} from "./run-secret-registry";

const RUN = "run-1";

describe("RunSecretRegistry", () => {
  it("masks registered values out of text + deep payloads for a run", () => {
    const reg = createRunSecretRegistry();
    reg.register(RUN, ["sk-live-9999", "db-pass-7777"]);
    expect(reg.maskText(RUN, "auth=sk-live-9999")).toBe("auth=****");
    expect(reg.maskDeep(RUN, { token: "db-pass-7777", n: 1 })).toEqual({
      token: "****",
      n: 1,
    });
  });

  it("is least-privilege: a value NOT registered for the run is not masked", () => {
    const reg = createRunSecretRegistry();
    reg.register(RUN, ["resolved-in-run"]);
    // A different secret that this run never resolved must pass through.
    expect(reg.maskText(RUN, "x=some-other-secret")).toBe("x=some-other-secret");
    // And a value registered for a DIFFERENT run doesn't leak across.
    reg.register("run-2", ["run-2-secret"]);
    expect(reg.maskText(RUN, "y=run-2-secret")).toBe("y=run-2-secret");
  });

  it("masks step output via the stepId link", () => {
    const reg = createRunSecretRegistry();
    reg.register(RUN, ["step-secret-abc"]);
    reg.linkStep("step-1", RUN);
    expect(reg.maskTextForStep("step-1", "v=step-secret-abc")).toBe("v=****");
    expect(reg.maskDeepForStep("step-1", { v: "step-secret-abc" })).toEqual({
      v: "****",
    });
    // An unknown step is a no-op (no run link).
    expect(reg.maskTextForStep("unknown", "v=step-secret-abc")).toBe(
      "v=step-secret-abc",
    );
  });

  it("drop() clears a run's values + step links (memory-only)", () => {
    const reg = createRunSecretRegistry();
    reg.register(RUN, ["gone-after-drop"]);
    reg.linkStep("step-1", RUN);
    reg.drop(RUN);
    expect(reg.maskText(RUN, "x=gone-after-drop")).toBe("x=gone-after-drop");
    expect(reg.maskTextForStep("step-1", "x=gone-after-drop")).toBe(
      "x=gone-after-drop",
    );
  });
});

describe("wrapGetServiceForRun", () => {
  function ref(id: string): ServiceRef<unknown> {
    return { id, T: undefined, toString: () => id };
  }

  interface ResolverShape {
    resolveSecret(input: { name: string }): Promise<string>;
    resolveForRun(input: {
      secretEnv: Record<string, string>;
    }): Promise<{ env: Record<string, string>; masking: unknown }>;
    resolveBySchema(input: {
      value: unknown;
      schema: unknown;
    }): Promise<{ resolved: unknown; warnings: string[] }>;
  }
  interface StoreShape {
    getConnectionWithCredentials(
      id: string,
    ): Promise<{ config: Record<string, unknown> } | undefined>;
    listConnections(): Promise<unknown[]>;
  }

  /** A getService that returns `svc` for any ref. */
  function constGetService<S>(svc: S): <T>(r: ServiceRef<T>) => Promise<T> {
    return <T>(_r: ServiceRef<T>) => Promise.resolve(svc as unknown as T);
  }

  it("registers values resolved via the resolver service (resolveForRun + resolveSecret)", async () => {
    const reg = createRunSecretRegistry();
    const resolver: ResolverShape = {
      resolveSecret: async () => "single-secret",
      resolveForRun: async () => ({
        env: { A: "env-secret-1", B: "env-secret-2" },
        masking: {},
      }),
      resolveBySchema: async () => ({
        resolved: { password: "schema-secret" },
        warnings: [],
      }),
    };
    const wrapped = wrapGetServiceForRun({
      getService: constGetService(resolver),
      runId: RUN,
      registry: reg,
      resolverRefId: "secrets.resolver",
      connectionStoreRefId: "integration.connectionStore",
    });
    const svc = await wrapped(ref("secrets.resolver") as ServiceRef<ResolverShape>);
    await svc.resolveForRun({ secretEnv: {} });
    await svc.resolveSecret({ name: "x" });
    await svc.resolveBySchema({ value: {}, schema: {} });
    // Every resolved value is now in the run's mask set.
    expect(reg.maskText(RUN, "env-secret-1 env-secret-2 single-secret schema-secret")).toBe(
      "**** **** **** ****",
    );
  });

  it("L3: forwards a non-intercepted resolver method untouched (Proxy + Reflect.get)", async () => {
    const reg = createRunSecretRegistry();
    // Resolver carries an extra method the wrapper does NOT intercept; a
    // hand-built literal would have dropped it.
    const resolver: ResolverShape & {
      describeNamedSecret: (name: string) => string;
    } = {
      resolveSecret: async (_input: { name: string }) =>
        "intercepted-secret-value",
      resolveForRun: async (_input: { secretEnv: Record<string, string> }) => ({
        env: {},
        masking: {},
      }),
      resolveBySchema: async (_input: { value: unknown; schema: unknown }) => ({
        resolved: {},
        warnings: [],
      }),
      // Not one of the three value-returning methods — must survive.
      describeNamedSecret: (name: string) => `meta:${name}`,
    };
    const wrapped = wrapGetServiceForRun({
      getService: constGetService(resolver),
      runId: RUN,
      registry: reg,
      resolverRefId: "secrets.resolver",
      connectionStoreRefId: "integration.connectionStore",
    });
    const svc = (await wrapped(
      ref("secrets.resolver") as ServiceRef<typeof resolver>,
    )) as typeof resolver;
    // The non-intercepted method is forwarded via Reflect.get, not dropped.
    expect(typeof svc.describeNamedSecret).toBe("function");
    expect(svc.describeNamedSecret("API")).toBe("meta:API");
    // And the intercepted method still registers its resolved value.
    await svc.resolveSecret({ name: "x" });
    expect(reg.maskText(RUN, "v=intercepted-secret-value")).toBe("v=****");
  });

  it("registers values resolved via the connection store credentials", async () => {
    const reg = createRunSecretRegistry();
    const store: StoreShape = {
      getConnectionWithCredentials: async () => ({
        config: { baseUrl: "https://x", apiToken: "conn-cred-secret" },
      }),
      // an unrelated passthrough method
      listConnections: async () => [],
    };
    const wrapped = wrapGetServiceForRun({
      getService: constGetService(store),
      runId: RUN,
      registry: reg,
      resolverRefId: "secrets.resolver",
      connectionStoreRefId: "integration.connectionStore",
    });
    const svc = await wrapped(
      ref("integration.connectionStore") as ServiceRef<StoreShape>,
    );
    await svc.getConnectionWithCredentials("c1");
    expect(reg.maskText(RUN, "token=conn-cred-secret")).toBe("token=****");
    // Passthrough methods still work.
    expect(await svc.listConnections()).toEqual([]);
  });

  it("passes other services through untouched", async () => {
    const reg = createRunSecretRegistry();
    const other = { foo: () => "bar" };
    const wrapped = wrapGetServiceForRun({
      getService: constGetService(other),
      runId: RUN,
      registry: reg,
      resolverRefId: "secrets.resolver",
      connectionStoreRefId: "integration.connectionStore",
    });
    expect(await wrapped(ref("some.other.service"))).toBe(other);
  });
});
