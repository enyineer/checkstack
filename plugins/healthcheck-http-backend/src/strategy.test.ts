import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "bun:test";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import { HttpHealthCheckStrategy } from "./strategy";

describe("HttpHealthCheckStrategy", () => {
  // Inject a deterministic DNS resolver so the in-process SSRF guard does not
  // depend on real network DNS in unit tests. By default every host resolves
  // to a public IP (allowed); specific tests override with their own resolver.
  const publicLookup = async () => [
    { address: "93.184.216.34", family: 4 },
  ];
  const strategy = new HttpHealthCheckStrategy(publicLookup);

  // A real local server backs the `client.exec` behaviour tests now that the
  // probe is rebuilt on node http (no `fetch` to mock). A loopback resolver
  // points the SSRF guard + IP pin at this server.
  let server: http.Server;
  let serverPort = 0;
  const loopbackLookup = async () => [{ address: "127.0.0.1", family: 4 }];
  const localStrategy = new HttpHealthCheckStrategy(loopbackLookup);
  const localUrl = (path: string) => `http://local.test:${serverPort}${path}`;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
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
      // v1->v2 fabricates the default timeout, v2->v3 strips the moved fields.
      expect(migrated).toEqual({ timeout: 30_000 });
    });

    it("carries a v1 timeout through both migration steps", async () => {
      const migrated = await strategy.config.parseAssumingV1({
        url: "https://example.com",
        method: "POST",
        timeout: 12_345,
      });
      expect(migrated).toEqual({ timeout: 12_345 });
    });

    it("is idempotent: an already-current {timeout} blob is unchanged", async () => {
      const migrated = await strategy.config.parseAssumingV1({ timeout: 5000 });
      expect(migrated).toEqual({ timeout: 5000 });
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

    it("preserves the original Host header while pinning to the IP", async () => {
      const connectedClient = await localStrategy.createClient({
        timeout: 5000,
      });
      const result = await connectedClient.client.exec({
        url: localUrl("/echo"),
        method: "GET",
        timeout: 5000,
      });

      const parsed = JSON.parse(result.body) as { host: string | null };
      // The server sees the intended virtual host, not the pinned IP literal.
      expect(parsed.host).toBe(`local.test:${serverPort}`);

      connectedClient.close();
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
});
