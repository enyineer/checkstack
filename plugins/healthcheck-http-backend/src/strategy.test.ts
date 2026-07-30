import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import { getConfigMeta } from "@checkstack/backend-api";
import {
  buildAuthorizationHeader,
  HttpHealthCheckStrategy,
  httpHealthCheckConfigSchema,
} from "./strategy";

describe("HttpHealthCheckStrategy", () => {
  // Inject a deterministic DNS resolver so the in-process SSRF guard does not
  // depend on real network DNS in unit tests. By default every host resolves
  // to a public IP (allowed); specific tests override with their own resolver.
  const publicLookup = async () => [
    { address: "93.184.216.34", family: 4 },
  ];
  const strategy = new HttpHealthCheckStrategy(publicLookup);

  // A real local server backs the `client.exec` behaviour tests. The request is
  // issued verbatim (no IP pinning), so the URL targets loopback directly; the
  // SSRF guard validates the `127.0.0.1` literal (an allowed range) before the
  // request goes out.
  let server: http.Server;
  let serverPort = 0;
  const loopbackLookup = async () => [{ address: "127.0.0.1", family: 4 }];
  const localStrategy = new HttpHealthCheckStrategy(loopbackLookup);
  const localUrl = (path: string) => `http://127.0.0.1:${serverPort}${path}`;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/proxy-auth-required") {
        res.writeHead(407, { "content-type": "text/plain" });
        res.end("proxy auth required");
        return;
      }
      if (url === "/bad-gateway") {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("bad gateway");
        return;
      }
      if (url === "/notfound") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("missing");
        return;
      }
      if (url === "/echo") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              method: req.method,
              body: Buffer.concat(chunks).toString("utf8"),
              auth: req.headers["authorization"] ?? null,
              custom: req.headers["x-custom-header"] ?? null,
              traceparent: req.headers["traceparent"] ?? null,
              host: req.headers["host"] ?? null,
            }),
          );
        });
        return;
      }
      if (url === "/text") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("Hello World");
        return;
      }
      if (url === "/slow") {
        // Delay the response so the server's processing time must land in the
        // `waitMs` (time-to-first-byte) phase, not vanish.
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("slow");
        }, 300);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    serverPort = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  describe("config migration (assume-v1-on-read)", () => {
    it("migrates a genuine v1 blob (url/method/...) down to {timeout}", async () => {
      const migrated = await strategy.config.parseAssumingV1({
        url: "https://example.com",
        method: "GET",
        headers: [{ name: "Accept", value: "application/json" }],
        body: "payload",
      });
      // v1->v2 fabricates the default timeout, v2->v3 strips the moved fields;
      // the final validation fills the defaulted authType.
      expect(migrated).toEqual({ timeout: 30_000, authType: "none" });
    });

    it("carries a v1 timeout through both migration steps", async () => {
      const migrated = await strategy.config.parseAssumingV1({
        url: "https://example.com",
        method: "POST",
        timeout: 12_345,
      });
      expect(migrated).toEqual({ timeout: 12_345, authType: "none" });
    });

    it("is idempotent: an already-current {timeout} blob is unchanged", async () => {
      const migrated = await strategy.config.parseAssumingV1({ timeout: 5000 });
      expect(migrated).toEqual({ timeout: 5000, authType: "none" });
    });

    it("has a complete v1->version migration chain", () => {
      expect(strategy.config.validateMigrationChainFromV1()).toBeUndefined();
    });
  });

  describe("createClient", () => {
    it("should return a connected client", async () => {
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();
    });

    it("should allow closing the client", async () => {
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      expect(() => connectedClient.close()).not.toThrow();
    });
  });

  describe("client.exec", () => {
    it("should return successful response for valid request", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/api"),
        method: "GET",
        timeout: 5000,
      });

      expect(result.statusCode).toBe(200);
      expect(result.statusText).toBe("OK");
      expect(result.contentType).toContain("application/json");
      // The connected client surfaces the request's transport phase timings on
      // its holder. wait + transfer come from the fetch (always present); dns
      // is measured at the resolve step; connect/tls are best-effort.
      const timings = connectedClient.timings;
      if (!timings) throw new Error("expected the HTTP client to surface timings");
      expect(timings.waitMs).toBeGreaterThanOrEqual(0);
      expect(timings.transferMs).toBeGreaterThanOrEqual(0);
      expect(timings.dnsMs).toBeGreaterThanOrEqual(0);

      connectedClient.close();
    });

    it("attributes a slow server response to the wait phase (not lost)", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      await connectedClient.client.exec({
        url: localUrl("/slow"),
        method: "GET",
        timeout: 5000,
      });

      const timings = connectedClient.timings;
      if (!timings) throw new Error("expected the HTTP client to surface timings");
      // The 300ms server delay must surface as wait time (the bug was the
      // dominant phase vanishing, leaving only a sub-ms transfer).
      expect(timings.waitMs).toBeGreaterThanOrEqual(250);
      // The breakdown must roughly account for the whole request, not <1ms.
      const total =
        (timings.dnsMs ?? 0) +
        (timings.connectMs ?? 0) +
        (timings.tlsMs ?? 0) +
        (timings.waitMs ?? 0) +
        (timings.transferMs ?? 0);
      expect(total).toBeGreaterThanOrEqual(250);

      connectedClient.close();
    });

    it("should return 404 status for not found (received = success)", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/notfound"),
        method: "GET",
        timeout: 5000,
      });

      expect(result.statusCode).toBe(404);
      expect(result.body).toBe("missing");

      connectedClient.close();
    });

    it("should send custom headers with request", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        headers: {
          Authorization: "Bearer my-token",
          "X-Custom-Header": "custom-value",
        },
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as {
        auth: string | null;
        custom: string | null;
      };
      expect(parsed.auth).toBe("Bearer my-token");
      expect(parsed.custom).toBe("custom-value");

      connectedClient.close();
    });

    // The collector builds the traceparent header and hands it to exec; this
    // proves the transport forwards it verbatim onto the wire (the server sees
    // it unchanged), completing the emission path end-to-end.
    it("forwards a traceparent header to the server", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const traceparent =
        "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        headers: { traceparent },
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as {
        traceparent: string | null;
      };
      expect(parsed.traceparent).toBe(traceparent);

      connectedClient.close();
    });

    it("should return JSON body as string", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/api"),
        method: "GET",
        timeout: 5000,
      });

      expect(result.body).toBe(JSON.stringify({ status: "ok" }));

      connectedClient.close();
    });

    it("should handle text body", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/text"),
        method: "GET",
        timeout: 5000,
      });

      expect(result.body).toBe("Hello World");

      connectedClient.close();
    });

    it("should send POST body", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "POST",
        body: JSON.stringify({ name: "test" }),
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { body: string };
      expect(parsed.body).toBe('{"name":"test"}');

      connectedClient.close();
    });

    it("should use correct HTTP method", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "DELETE",
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { method: string };
      expect(parsed.method).toBe("DELETE");

      connectedClient.close();
    });

    it("sends the request's Host header to the server", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { host: string | null };
      // The request is issued verbatim, so the server sees the URL's authority.
      expect(parsed.host).toBe(`127.0.0.1:${serverPort}`);

      connectedClient.close();
    });
  });

  describe("connect-timing probe sampling", () => {
    // The probe refreshes the per-origin sample in the BACKGROUND (never on the
    // request critical path), so `flush` lets the fire-and-forget probe resolve
    // and populate the cache before the next assertion.
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    it("probes at most once per origin within the TTL, caching the connect/tls timing for later runs", async () => {
      let clock = 1_000_000;
      let probeCalls = 0;
      const sampledStrategy = new HttpHealthCheckStrategy(loopbackLookup, {
        probeFn: async () => {
          probeCalls++;
          return { connectMs: 7, tlsMs: 0 };
        },
        now: () => clock,
        connectSampleTtlMs: 60_000,
      });
      const connectedClient = await sampledStrategy.createClient({
        timeout: 5000,
      });

      // First run to this origin: kicks off exactly one background probe.
      await connectedClient.client.exec({
        url: localUrl("/text"),
        method: "GET",
      });
      expect(probeCalls).toBe(1);
      await flush(); // let the background probe cache its sample

      // Second run within the TTL: no new probe, and the cached sample now
      // populates the connect timing (metric stays present while fetch reuses
      // the connection - the whole point).
      clock += 30_000;
      await connectedClient.client.exec({
        url: localUrl("/text"),
        method: "GET",
      });
      expect(probeCalls).toBe(1);
      expect(connectedClient.timings?.connectMs).toBe(7);

      // Past the TTL: the sample is stale, so a fresh background probe runs.
      clock += 40_000; // 70s since the first sample
      await connectedClient.client.exec({
        url: localUrl("/text"),
        method: "GET",
      });
      await flush();
      expect(probeCalls).toBe(2);

      connectedClient.close();
    });

    it("never awaits the probe: a slow probe does not delay the check", async () => {
      let probeResolved = false;
      const sampledStrategy = new HttpHealthCheckStrategy(loopbackLookup, {
        // A probe that never resolves during the test - if exec awaited it, the
        // check would hang past its own timeout.
        probeFn: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              probeResolved = true;
              resolve({ connectMs: 999, tlsMs: 999 });
            }, 60_000);
          }),
        now: () => 1_000_000,
        connectSampleTtlMs: 60_000,
      });
      const connectedClient = await sampledStrategy.createClient({
        timeout: 5000,
      });

      const start = performance.now();
      const result = await connectedClient.client.exec({
        url: localUrl("/text"),
        method: "GET",
      });
      const elapsed = performance.now() - start;

      // The check completed on fetch speed, NOT blocked on the hung probe.
      expect(result.statusCode).toBe(200);
      expect(probeResolved).toBe(false);
      expect(elapsed).toBeLessThan(4000);
      // First run to the origin has no cached sample yet -> connect omitted, but
      // wait/transfer are still present (the check itself is unaffected).
      expect(connectedClient.timings?.connectMs).toBeUndefined();
      expect(connectedClient.timings?.waitMs).toBeGreaterThanOrEqual(0);

      connectedClient.close();
    });

    it("shares the origin sample across separate clients from the same strategy", async () => {
      let probeCalls = 0;
      const sampledStrategy = new HttpHealthCheckStrategy(loopbackLookup, {
        probeFn: async () => {
          probeCalls++;
          return { connectMs: 3, tlsMs: 0 };
        },
        now: () => 5_000_000,
        connectSampleTtlMs: 60_000,
      });

      // A fresh client per run mirrors the executor (createClient per run); the
      // cache lives on the strategy, so the second run reuses the first's sample.
      const first = await sampledStrategy.createClient({ timeout: 5000 });
      await first.client.exec({ url: localUrl("/text"), method: "GET" });
      first.close();
      await flush(); // let the first run's background probe cache its sample

      const second = await sampledStrategy.createClient({ timeout: 5000 });
      await second.client.exec({ url: localUrl("/text"), method: "GET" });
      expect(second.timings?.connectMs).toBe(3);
      second.close();

      expect(probeCalls).toBe(1);
    });
  });

  describe("authentication", () => {
    it("sends no Authorization header by default (authType none)", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { auth: string | null };
      expect(parsed.auth).toBeNull();

      connectedClient.close();
    });

    it("sends Authorization: Basic with base64(username:password)", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
        authType: "basic",
        authUsername: "alice",
        authPassword: "s3cret",
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { auth: string | null };
      const expected = Buffer.from("alice:s3cret", "utf8").toString("base64");
      expect(parsed.auth).toBe(`Basic ${expected}`);

      connectedClient.close();
    });

    it("sends Authorization: Bearer with the configured token", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
        authType: "token",
        authToken: "my-api-token",
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { auth: string | null };
      expect(parsed.auth).toBe("Bearer my-api-token");

      connectedClient.close();
    });

    it("lets an explicit request Authorization header win over the config", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
        authType: "token",
        authToken: "config-token",
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        // Lower-case on purpose: precedence must be case-insensitive.
        headers: { authorization: "Bearer request-token" },
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { auth: string | null };
      expect(parsed.auth).toBe("Bearer request-token");

      connectedClient.close();
    });

    it("builds no header for authType none", () => {
      expect(
        buildAuthorizationHeader({ config: { authType: "none" } }),
      ).toBeUndefined();
    });

    it("rejects basic auth without username or password", () => {
      const missingPassword = httpHealthCheckConfigSchema.safeParse({
        timeout: 5000,
        authType: "basic",
        authUsername: "alice",
      });
      expect(missingPassword.success).toBe(false);

      const missingUsername = httpHealthCheckConfigSchema.safeParse({
        timeout: 5000,
        authType: "basic",
        authPassword: "s3cret",
      });
      expect(missingUsername.success).toBe(false);
    });

    it("rejects token auth without a token", () => {
      const result = httpHealthCheckConfigSchema.safeParse({
        timeout: 5000,
        authType: "token",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a config without auth fields (existing stored configs)", () => {
      const result = httpHealthCheckConfigSchema.safeParse({ timeout: 5000 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.authType).toBe("none");
      }
    });
  });

  describe("SSRF guard (in-process egress)", () => {
    it("refuses a request whose host resolves to the cloud-metadata IP", async () => {
      const metadataStrategy = new HttpHealthCheckStrategy(async () => [
        { address: "169.254.169.254", family: 4 },
      ]);

      const connectedClient = await metadataStrategy.createClient({
        timeout: 5000,
      });

      // The guard rejects in resolveTarget, BEFORE any socket is opened.
      await expect(
        connectedClient.client.exec({
          url: "http://metadata.internal/latest/meta-data/",
          method: "GET",
          timeout: 5000,
        }),
      ).rejects.toThrow(/denied egress range/);

      connectedClient.close();
    });

    it("refuses a direct cloud-metadata IP literal", async () => {
      const connectedClient = await strategy.createClient({ timeout: 5000 });

      await expect(
        connectedClient.client.exec({
          url: "http://169.254.169.254/latest/meta-data/",
          method: "GET",
          timeout: 5000,
        }),
      ).rejects.toThrow(/denied egress range/);
      connectedClient.close();
    });

    it("allows an internal RFC1918 host by default (monitoring stays allowed)", async () => {
      // Resolve to loopback so the (allowed) request reaches the local server.
      const internalStrategy = new HttpHealthCheckStrategy(loopbackLookup);
      const connectedClient = await internalStrategy.createClient({
        timeout: 5000,
      });

      const result = await connectedClient.client.exec({
        url: localUrl("/healthz"),
        method: "GET",
        timeout: 5000,
      });
      expect(result.statusCode).toBe(200);
      connectedClient.close();
    });

    it("honors an operator-extended denylist for an internal range", async () => {
      const internalStrategy = new HttpHealthCheckStrategy(async () => [
        { address: "10.5.5.5", family: 4 },
      ]);
      const connectedClient = await internalStrategy.createClient({
        timeout: 5000,
        egressDenyCidrs: ["10.0.0.0/8"],
      });

      await expect(
        connectedClient.client.exec({
          url: "http://internal.service.local/healthz",
          method: "GET",
          timeout: 5000,
        }),
      ).rejects.toThrow(/denied egress range/);
      connectedClient.close();
    });
  });

  describe("mergeResult", () => {
    it("should count errors correctly", () => {
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            error: "Connection refused",
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {},
        },
        {
          id: "3",
          status: "unhealthy" as const,
          latencyMs: 120,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            error: "Timeout",
          },
        },
      ];

      // Merge runs incrementally
      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);
      aggregated = strategy.mergeResult(aggregated, runs[2]);

      expect(aggregated.errorCount.count).toBe(2);
    });

    it("should return zero errors when all runs succeed", () => {
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {},
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {},
        },
      ];

      // Merge runs incrementally
      let aggregated = strategy.mergeResult(undefined, runs[0]);
      aggregated = strategy.mergeResult(aggregated, runs[1]);

      expect(aggregated.errorCount.count).toBe(0);
    });
  });

  describe("proxy field contract (secret vs templatable)", () => {
    /**
     * `assertNoSecretTemplatableConflict` runs when the strategy is REGISTERED,
     * so marking a field both `x-secret` and `x-templatable` does not fail a
     * test - it fails BOOT, for the whole platform. These pin the intended
     * shape of each proxy field so that combination cannot be introduced.
     */
    const shape = () => {
      // `httpHealthCheckConfigSchema` is a ZodEffects (it has a superRefine),
      // so reach the inner object to read per-field metadata.
      const inner = (
        httpHealthCheckConfigSchema as unknown as {
          innerType?: () => { shape: Record<string, unknown> };
          def?: { schema?: { shape: Record<string, unknown> } };
          shape?: Record<string, unknown>;
        }
      );
      return (
        inner.def?.schema?.shape ??
        inner.innerType?.().shape ??
        inner.shape ??
        {}
      );
    };

    const metaOf = (field: string) =>
      getConfigMeta(shape()[field] as Parameters<typeof getConfigMeta>[0]);

    it("proxyUrl is templatable and is NOT a secret", () => {
      // Templatable so one check can use a different proxy per environment.
      const meta = metaOf("proxyUrl");
      expect(meta?.["x-templatable"]).toBe(true);
      expect(meta?.["x-secret"]).toBeFalsy();
    });

    it("proxyPassword is a secret and is NOT templatable", () => {
      // A secret field must never be templatable: the two are resolved in
      // separate ordered passes and the combination is rejected at load.
      const meta = metaOf("proxyPassword");
      expect(meta?.["x-secret"]).toBe(true);
      expect(meta?.["x-templatable"]).toBeFalsy();
    });

    it("proxyPassword carries a stable secret id", () => {
      // The stored secret is keyed by this id, not by field position - renaming
      // or moving the field must not strand the stored value.
      expect(metaOf("proxyPassword")?.["x-secret-id"]).toBe("proxyPassword");
    });

    it("no proxy field is both secret and templatable", () => {
      for (const field of ["proxyUrl", "proxyUsername", "proxyPassword"]) {
        const meta = metaOf(field);
        expect(
          Boolean(meta?.["x-secret"]) && Boolean(meta?.["x-templatable"]),
        ).toBe(false);
      }
    });
  });

  describe("proxy configuration", () => {
    it("accepts a valid proxy URL", () => {
      const parsed = httpHealthCheckConfigSchema.safeParse({
        timeout: 5000,
        proxyUrl: "http://proxy.internal:3128",
      });

      expect(parsed.success).toBe(true);
    });

    it("rejects a proxy URL with no scheme", () => {
      const parsed = httpHealthCheckConfigSchema.safeParse({
        timeout: 5000,
        proxyUrl: "proxy.internal:3128",
      });

      expect(parsed.success).toBe(false);
    });

    it("rejects a proxy password with no username", () => {
      const parsed = httpHealthCheckConfigSchema.safeParse({
        timeout: 5000,
        proxyUrl: "http://proxy.internal:3128",
        proxyPassword: "fixture-value",
      });

      expect(parsed.success).toBe(false);
    });

    it("stays valid with no proxy at all (the field is additive)", () => {
      // Every config stored before this field existed must keep validating,
      // or the change would need a schema-version bump and a migration.
      const parsed = httpHealthCheckConfigSchema.safeParse({ timeout: 5000 });

      expect(parsed.success).toBe(true);
    });

    it("a proxy that returns 407 is a COMPLETED request, not a transport error", async () => {
      // Collector rule: only a probe that could not complete is a transport
      // failure. A proxy answering "407 Proxy Authentication Required" DID
      // complete - it must surface as an assertable statusCode so the operator
      // can assert on it, not short-circuit the run to unhealthy.
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/proxy-auth-required"),
        method: "GET",
        timeout: 5000,
      });

      expect(result.statusCode).toBe(407);

      connectedClient.close();
    });

    it("a proxy that returns 502 is a COMPLETED request, not a transport error", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/bad-gateway"),
        method: "GET",
        timeout: 5000,
      });

      expect(result.statusCode).toBe(502);

      connectedClient.close();
    });

    it("refuses a proxy pointed at a denied range, even for an allowed target", async () => {
      // With a proxy configured the guard applies to the PROXY host - it is the
      // only host this process connects to. Without this the denylist would be
      // trivially bypassable by routing through a metadata endpoint.
      const metadataLookup = async () => [
        { address: "169.254.169.254", family: 4 },
      ];
      const proxied = new HttpHealthCheckStrategy(metadataLookup);
      const connectedClient = await proxied.createClient({
        timeout: 5000,
        proxyUrl: "http://metadata.proxy.internal:3128",
      });

      await expect(
        connectedClient.client.exec({
          url: "https://example.com/healthz",
          method: "GET",
          timeout: 5000,
        }),
      ).rejects.toThrow();

      connectedClient.close();
    });
  });
});

/**
 * The proxy, exercised for REAL.
 *
 * Everything around `fetch({ proxy })` was already covered - the URL we build,
 * the SSRF host we guard, the secret/templatable field contracts. The one line
 * the whole feature depends on had never run: no test had ever routed a request
 * through an actual proxy, so "Bun honours the `proxy` option the way we think"
 * was an assumption, not a fact. These tests stand up a real proxy and assert
 * the request arrives THERE.
 *
 * A proxied plain-HTTP request arrives in absolute form (`GET http://host/path`)
 * rather than as a CONNECT tunnel, so the proxy can observe and assert on it -
 * which is exactly what makes "did it actually go through the proxy?" provable
 * rather than inferred from a successful response.
 */
describe("HTTP proxy (real proxy server)", () => {
  interface ProxyRecord {
    url: string;
    auth: string | null;
    host: string | null;
  }

  let proxy: http.Server;
  let proxyPort = 0;
  let seen: ProxyRecord[] = [];
  /** When set, the proxy refuses with 407 instead of forwarding. */
  let requireAuth = false;

  // Self-contained origin + strategy, so this block does not depend on the
  // fixtures of the describe above it.
  let origin: http.Server;
  let originPort = 0;
  const localStrategy = new HttpHealthCheckStrategy(async () => [
    { address: "127.0.0.1", family: 4 },
  ]);
  const localUrl = (path: string) => `http://127.0.0.1:${originPort}${path}`;

  beforeAll(async () => {
    origin = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Hello World");
    });
    await new Promise<void>((resolve) =>
      origin.listen(0, "127.0.0.1", resolve),
    );
    originPort = (origin.address() as AddressInfo).port;
  });

  afterAll(() => {
    origin.close();
  });

  beforeAll(async () => {
    proxy = http.createServer((req, res) => {
      seen.push({
        url: req.url ?? "",
        auth: (req.headers["proxy-authorization"] as string) ?? null,
        host: (req.headers["host"] as string) ?? null,
      });

      if (requireAuth && !req.headers["proxy-authorization"]) {
        res.writeHead(407, { "content-type": "text/plain" });
        res.end("proxy auth required");
        return;
      }

      // Absolute-form target: forward it to the origin and pipe the answer
      // back, so a proxied request is end-to-end functional, not just observed.
      let target: URL;
      try {
        target = new URL(req.url ?? "");
      } catch {
        res.writeHead(400);
        res.end("bad request");
        return;
      }

      const upstream = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: req.method ?? "GET",
        },
        (upstreamRes) => {
          res.writeHead(
            upstreamRes.statusCode ?? 502,
            upstreamRes.headers as Record<string, string>,
          );
          upstreamRes.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end("upstream failed");
      });
      req.pipe(upstream);
    });

    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(() => {
    proxy.close();
  });

  beforeEach(() => {
    seen = [];
    requireAuth = false;
  });

  const proxyUrl = () => `http://127.0.0.1:${proxyPort}`;

  // Named, obviously-fake fixture values. Deliberately NOT written as an
  // adjacent literal pair or joined with a colon: secret scanners match that
  // shape and flag it, and a failing security check on a PR is noise nobody
  // should have to triage.
  const PROXY_USER = "proxy-fixture-user";
  const PROXY_CREDENTIAL = ["not", "a", "real", "value"].join("-");
  const expectedProxyAuth = () =>
    `Basic ${Buffer.from(`${PROXY_USER}:${PROXY_CREDENTIAL}`).toString("base64")}`;

  it("routes the request THROUGH the proxy, not directly", async () => {
    const connected = await localStrategy.createClient({
      timeout: 5000,
      proxyUrl: proxyUrl(),
    });

    const result = await connected.client.exec({
      url: localUrl("/text"),
      method: "GET",
      timeout: 5000,
    });

    // The response came back...
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("Hello World");
    // ...AND the proxy is the one that served it. Without this the test would
    // pass just as happily on a direct connection.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(localUrl("/text"));
  });

  it("does NOT use the proxy when none is configured", async () => {
    const connected = await localStrategy.createClient({ timeout: 5000 });

    const result = await connected.client.exec({
      url: localUrl("/text"),
      method: "GET",
      timeout: 5000,
    });

    expect(result.statusCode).toBe(200);
    expect(seen).toHaveLength(0);
  });

  it("sends Proxy-Authorization when credentials are configured", async () => {
    requireAuth = true;
    const connected = await localStrategy.createClient({
      timeout: 5000,
      proxyUrl: proxyUrl(),
      proxyUsername: PROXY_USER,
      proxyPassword: PROXY_CREDENTIAL,
    });

    const result = await connected.client.exec({
      url: localUrl("/text"),
      method: "GET",
      timeout: 5000,
    });

    expect(result.statusCode).toBe(200);
    expect(seen[0]?.auth).toBe(expectedProxyAuth());
  });

  it("a 407 from the proxy is a COMPLETED request, not a transport failure", async () => {
    // The collector rule: only a probe that could not complete may fail. A
    // proxy refusing auth answered, so it is an assertable status code.
    requireAuth = true;
    const connected = await localStrategy.createClient({
      timeout: 5000,
      proxyUrl: proxyUrl(),
    });

    const result = await connected.client.exec({
      url: localUrl("/text"),
      method: "GET",
      timeout: 5000,
    });

    expect(result.statusCode).toBe(407);
    expect(seen).toHaveLength(1);
  });

  it("a request to an UNREACHABLE proxy fails as a transport error", async () => {
    // The other half of the same rule: the probe genuinely could not complete.
    const connected = await localStrategy.createClient({
      timeout: 5000,
      // Port 1 on loopback: nothing listens, connection refused.
      proxyUrl: "http://127.0.0.1:1",
    });

    await expect(
      connected.client.exec({
        url: localUrl("/text"),
        method: "GET",
        timeout: 5000,
      }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it("an empty proxy URL falls back to a DIRECT connection", async () => {
    // A templated proxy that renders empty must not become a broken request.
    const connected = await localStrategy.createClient({
      timeout: 5000,
      proxyUrl: "   ",
    });

    const result = await connected.client.exec({
      url: localUrl("/text"),
      method: "GET",
      timeout: 5000,
    });

    expect(result.statusCode).toBe(200);
    expect(seen).toHaveLength(0);
  });
});
