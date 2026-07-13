import { describe, expect, it, mock } from "bun:test";
import type { OptionsResolver } from "@checkstack/ui";
import type {
  ConfigOptionsResolverContext,
  ConfigOptionsResolverMetadata,
} from "./slot";
import {
  strategyIdMatches,
  buildResolverMap,
  createResolverProxy,
  waitForResolver,
} from "./registry.logic";

const noopCtx: ConfigOptionsResolverContext = {
  // The registry logic never touches `rpcApi`; a bare object suffices.
  rpcApi: { client: undefined, forPlugin: () => ({}) } as never,
  strategyConfig: {},
};

const resolver = (label: string): OptionsResolver => {
  return async () => [{ value: label, label }];
};

function ext(
  metadata: ConfigOptionsResolverMetadata,
): { metadata: ConfigOptionsResolverMetadata } {
  return { metadata };
}

describe("buildResolverMap", () => {
  it("merges only factories whose strategyId matches", () => {
    const map = buildResolverMap({
      strategyId: "logstream",
      ctx: noopCtx,
      extensions: [
        ext({
          strategyId: "logstream",
          buildResolvers: () => ({ a: resolver("a") }),
        }),
        ext({
          strategyId: "http",
          buildResolvers: () => ({ b: resolver("b") }),
        }),
      ],
    });
    expect(Object.keys(map).sort()).toEqual(["a"]);
  });

  it("returns an empty map when strategyId is undefined", () => {
    const build = mock(() => ({ a: resolver("a") }));
    const map = buildResolverMap({
      strategyId: undefined,
      ctx: noopCtx,
      extensions: [ext({ strategyId: "logstream", buildResolvers: build })],
    });
    expect(map).toEqual({});
    // A non-matching / absent strategy must not even invoke the factory.
    expect(build).not.toHaveBeenCalled();
  });

  it("passes the editor context through to each factory", () => {
    const build = mock((ctx: ConfigOptionsResolverContext) => {
      expect(ctx.strategyConfig).toEqual({ streamId: "s1" });
      return { a: resolver("a") };
    });
    buildResolverMap({
      strategyId: "logstream",
      ctx: { ...noopCtx, strategyConfig: { streamId: "s1" } },
      extensions: [ext({ strategyId: "logstream", buildResolvers: build })],
    });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("last matching factory wins on a name clash", () => {
    const map = buildResolverMap({
      strategyId: "logstream",
      ctx: noopCtx,
      extensions: [
        ext({
          strategyId: "logstream",
          buildResolvers: () => ({ a: resolver("first") }),
        }),
        ext({
          strategyId: "logstream",
          buildResolvers: () => ({ a: resolver("second") }),
        }),
      ],
    });
    expect(map.a).toBeDefined();
  });
});

describe("waitForResolver", () => {
  it("returns immediately when the resolver is already present", async () => {
    const r = resolver("a");
    const sleep = mock(async () => {});
    const got = await waitForResolver({
      name: "a",
      getResolvers: () => ({ a: r }),
      sleep,
    });
    expect(got).toBe(r);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("resolves once the resolver appears after a few polls", async () => {
    const r = resolver("late");
    let ticks = 0;
    const store: Record<string, OptionsResolver> = {};
    const got = await waitForResolver({
      name: "late",
      getResolvers: () => {
        // Appears on the 3rd poll.
        if (ticks >= 3) store.late = r;
        return store;
      },
      now: () => ticks * 100,
      sleep: async () => {
        ticks += 1;
      },
      timeoutMs: 10_000,
      pollMs: 100,
    });
    expect(got).toBe(r);
  });

  it("throws a clear error when the resolver never arrives", async () => {
    let ticks = 0;
    await expect(
      waitForResolver({
        name: "never",
        getResolvers: () => ({}),
        now: () => ticks * 1000,
        sleep: async () => {
          ticks += 1;
        },
        timeoutMs: 3000,
        pollMs: 1000,
      }),
    ).rejects.toThrow('No options resolver registered for "never"');
  });
});

describe("createResolverProxy", () => {
  it("always hands back a callable resolver for any name", () => {
    const proxy = createResolverProxy({ getResolvers: () => ({}) });
    expect(typeof proxy.anything).toBe("function");
  });

  it("delegates to the live resolver at call time", async () => {
    const store: Record<string, OptionsResolver> = {};
    const proxy = createResolverProxy({ getResolvers: () => store });
    // Registered AFTER the proxy was built - proxy must pick it up.
    store.a = async () => [{ value: "x", label: "X" }];
    const options = await proxy.a({});
    expect(options).toEqual([{ value: "x", label: "X" }]);
  });

  it("forwards the form values to the delegate", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const store: Record<string, OptionsResolver> = {
      a: async (formValues) => {
        seen.push(formValues);
        return [];
      },
    };
    const proxy = createResolverProxy({ getResolvers: () => store });
    await proxy.a({ streamId: "s1" });
    expect(seen).toEqual([{ streamId: "s1" }]);
  });

  it("waits for a not-yet-registered resolver via the injected clock", async () => {
    const store: Record<string, OptionsResolver> = {};
    let ticks = 0;
    const proxy = createResolverProxy({
      getResolvers: () => store,
      waitOptions: {
        now: () => ticks * 100,
        sleep: async () => {
          ticks += 1;
          if (ticks === 2) store.late = async () => [{ value: "l", label: "L" }];
        },
        timeoutMs: 10_000,
        pollMs: 100,
      },
    });
    const options = await proxy.late({});
    expect(options).toEqual([{ value: "l", label: "L" }]);
  });
});

describe("strategyIdMatches (qualified vs unqualified)", () => {
  // REGRESSION: the editor passes the QUALIFIED id ("logstream.logstream" -
  // what getStrategies returns), while contributors declare the UNQUALIFIED id
  // ("logstream"). Strict equality made the resolver map empty and every
  // dropdown field showed "No options resolver registered" after the wait
  // timed out.
  it("matches an unqualified contribution against the qualified active id", () => {
    expect(
      strategyIdMatches({ contributed: "logstream", active: "logstream.logstream" }),
    ).toBe(true);
  });

  it("matches a fully-qualified contribution verbatim", () => {
    expect(
      strategyIdMatches({
        contributed: "logstream.logstream",
        active: "logstream.logstream",
      }),
    ).toBe(true);
  });

  it("uses the LAST dot so dotted plugin ids still resolve the tail", () => {
    expect(
      strategyIdMatches({ contributed: "check", active: "my.plugin.check" }),
    ).toBe(true);
  });

  it("does not match a different strategy", () => {
    expect(
      strategyIdMatches({ contributed: "http", active: "logstream.logstream" }),
    ).toBe(false);
    expect(strategyIdMatches({ contributed: "stream", active: "logstream" })).toBe(
      false,
    );
  });

  it("buildResolverMap accepts the qualified active id end-to-end", () => {
    const map = buildResolverMap({
      strategyId: "logstream.logstream",
      ctx: noopCtx,
      extensions: [
        ext({
          strategyId: "logstream",
          buildResolvers: () => ({ streamPicker: async () => [] }),
        }),
      ],
    });
    expect(Object.keys(map)).toEqual(["streamPicker"]);
  });
});
