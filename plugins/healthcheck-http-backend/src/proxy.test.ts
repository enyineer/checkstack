import { describe, expect, test } from "bun:test";
import {
  buildProxyUrl,
  describeProxyUrlProblem,
  resolveGuardedHost,
} from "./proxy";

describe("describeProxyUrlProblem", () => {
  test("accepts an http proxy", () => {
    expect(
      describeProxyUrlProblem({ proxyUrl: "http://proxy.internal:3128" }),
    ).toBeUndefined();
  });

  test("accepts an https proxy", () => {
    expect(
      describeProxyUrlProblem({ proxyUrl: "https://proxy.internal:3128" }),
    ).toBeUndefined();
  });

  test("rejects a bare host with no scheme, with actionable guidance", () => {
    // `new URL("proxy.internal:3128")` PARSES - it reads `proxy.internal:` as
    // the scheme - so this case needs its own check or the author is told
    // "must use http or https (got proxy.internal)", which explains nothing.
    const problem = describeProxyUrlProblem({
      proxyUrl: "proxy.internal:3128",
    });

    expect(problem).toContain("http://");
  });

  test("rejects a non-http scheme", () => {
    // socks5 is not something Bun's fetch proxy option supports; accepting it
    // would fail opaquely at request time instead of in the editor.
    expect(
      describeProxyUrlProblem({ proxyUrl: "socks5://proxy.internal:1080" }),
    ).toBeDefined();
  });

  test("rejects gibberish", () => {
    expect(describeProxyUrlProblem({ proxyUrl: "not a url" })).toBeDefined();
  });
});

describe("buildProxyUrl", () => {
  test("returns undefined when no proxy is configured", () => {
    expect(buildProxyUrl({})).toBeUndefined();
    expect(buildProxyUrl({ proxyUrl: "" })).toBeUndefined();
    expect(buildProxyUrl({ proxyUrl: "   " })).toBeUndefined();
  });

  test("passes a credential-less proxy through", () => {
    expect(buildProxyUrl({ proxyUrl: "http://proxy.internal:3128" })).toBe(
      "http://proxy.internal:3128/",
    );
  });

  test("folds credentials into the userinfo", () => {
    const url = buildProxyUrl({
      proxyUrl: "http://proxy.internal:3128",
      username: "svc",
      password: "hunter2",
    });

    expect(url).toBe("http://svc:hunter2@proxy.internal:3128/");
  });

  test("percent-encodes credentials so they cannot rewrite the host", () => {
    // A password containing `@` would otherwise terminate the userinfo early
    // and send the request to an attacker-chosen proxy.
    const url = buildProxyUrl({
      proxyUrl: "http://proxy.internal:3128",
      username: "svc",
      password: "p@ss:word",
    });

    expect(new URL(url ?? "").hostname).toBe("proxy.internal");
    expect(url).not.toContain("p@ss");
  });

  test("ignores a password with no username", () => {
    // The schema rejects this combination, but a stored config predating the
    // rule must not produce a malformed proxy URL.
    const url = buildProxyUrl({
      proxyUrl: "http://proxy.internal:3128",
      password: "hunter2",
    });

    expect(url).toBe("http://proxy.internal:3128/");
  });

  test("returns undefined for a malformed proxy rather than a wrong host", () => {
    expect(buildProxyUrl({ proxyUrl: "not a url" })).toBeUndefined();
  });
});

describe("resolveGuardedHost", () => {
  const target = new URL("https://api.example.com/healthz");

  test("guards the target when there is no proxy", () => {
    expect(resolveGuardedHost({ targetUrl: target })).toEqual({
      host: "api.example.com",
      viaProxy: false,
    });
  });

  test("guards the PROXY when one is configured", () => {
    // The proxy is the only host this process connects to, so it is the only
    // one the denylist can meaningfully police.
    expect(
      resolveGuardedHost({
        targetUrl: target,
        proxyUrl: "http://proxy.internal:3128",
      }),
    ).toEqual({ host: "proxy.internal", viaProxy: true });
  });

  test("an empty proxy string is treated as no proxy", () => {
    expect(
      resolveGuardedHost({ targetUrl: target, proxyUrl: "  " }),
    ).toEqual({ host: "api.example.com", viaProxy: false });
  });

  test("falls back to guarding the target if the proxy is unparseable", () => {
    // Never end up with NO guard at all.
    expect(
      resolveGuardedHost({ targetUrl: target, proxyUrl: "not a url" }),
    ).toEqual({ host: "api.example.com", viaProxy: false });
  });

  test("a proxy pointed at a metadata endpoint is what gets guarded", () => {
    // The denylist then refuses it, exactly as it would refuse the target.
    expect(
      resolveGuardedHost({
        targetUrl: target,
        proxyUrl: "http://169.254.169.254:80",
      }),
    ).toEqual({ host: "169.254.169.254", viaProxy: true });
  });
});

describe("proxy credentials round-trip exactly", () => {
  /**
   * A proxy rejects a mangled password with 407, which surfaces as a COMPLETED
   * request - so a double-encoding bug here would not fail loudly, it would
   * quietly make every proxied check unauthorised. These pin the exact bytes.
   */
  const cases = [
    "hunter2",
    "p@ss:word",
    "with space",
    "100%sure",
    "sl/ash",
    "qu?ery&amp",
    "uniçode",
  ];

  test.each(cases)("password %j survives the round-trip", (password) => {
    const url = buildProxyUrl({
      proxyUrl: "http://proxy.internal:3128",
      username: "svc",
      password,
    });
    const parsed = new URL(url ?? "");

    // Decoded back to exactly what the operator typed - no double-encoding.
    expect(decodeURIComponent(parsed.password)).toBe(password);
    // And the host is never rewritten by anything in the credentials.
    expect(parsed.hostname).toBe("proxy.internal");
    expect(parsed.port).toBe("3128");
  });

  test("a username with an @ cannot rewrite the proxy host", () => {
    const url = buildProxyUrl({
      proxyUrl: "http://proxy.internal:3128",
      username: "evil@attacker.test",
      password: "x",
    });

    expect(new URL(url ?? "").hostname).toBe("proxy.internal");
  });
});

describe("a proxy URL that TEMPLATES to empty falls back safely", () => {
  /**
   * `proxyUrl` is `x-templatable`, so `{{ environment.proxyUrl }}` renders per
   * environment - and renders EMPTY for an environment that has no such field
   * (the engine is non-strict). Both halves must then agree that there is no
   * proxy, or the request would go direct while the SSRF guard still checked a
   * proxy host that is not being used.
   */
  const target = new URL("https://api.example.com/healthz");

  test.each(["", "   ", "\t"])(
    "a rendered-empty proxy (%j) means a direct connection",
    (proxyUrl) => {
      expect(buildProxyUrl({ proxyUrl })).toBeUndefined();
    },
  );

  test.each(["", "   "])(
    "...and the TARGET is what gets guarded (%j)",
    (proxyUrl) => {
      expect(resolveGuardedHost({ targetUrl: target, proxyUrl })).toEqual({
        host: "api.example.com",
        viaProxy: false,
      });
    },
  );
});
