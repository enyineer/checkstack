import { describe, expect, it, mock } from "bun:test";
import { CertificateCollector } from "./certificate-collector";
import type {
  TlsTransportClient,
  TlsCertificateInfo,
} from "./transport-client";

describe("CertificateCollector", () => {
  const createMockClient = (
    response: Partial<TlsCertificateInfo> = {}
  ): TlsTransportClient => ({
    exec: mock(() =>
      Promise.resolve({
        isValid: response.isValid ?? true,
        isSelfSigned: response.isSelfSigned ?? false,
        subject: response.subject ?? "CN=example.com",
        issuer: response.issuer ?? "CN=Let's Encrypt",
        validFrom: response.validFrom ?? "2024-01-01T00:00:00Z",
        validTo: response.validTo ?? "2025-01-01T00:00:00Z",
        daysUntilExpiry: response.daysUntilExpiry ?? 365,
        daysRemaining: response.daysRemaining ?? 365,
        error: response.error,
      })
    ),
  });

  describe("execute", () => {
    it("should get certificate info successfully", async () => {
      const collector = new CertificateCollector();
      const client = createMockClient({ daysRemaining: 90 });

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.subject).toBe("CN=example.com");
      expect(result.result.issuer).toBe("CN=Let's Encrypt");
      expect(result.result.daysRemaining).toBe(90);
      expect(result.result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return error for failed TLS connection", async () => {
      const collector = new CertificateCollector();
      const client = createMockClient({
        error: "Connection refused",
        isValid: false,
        daysRemaining: 0,
        daysUntilExpiry: 0,
      });

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.valid).toBe(false);
      expect(result.error).toBe("Connection refused");
    });

    it("should mark expired certificate as invalid", async () => {
      const collector = new CertificateCollector();
      const client = createMockClient({ daysRemaining: 0 });

      const result = await collector.execute({
        config: {},
        client,
        pluginId: "test",
      });

      expect(result.result.valid).toBe(false);
      expect(result.result.daysRemaining).toBe(0);
    });
  });

  describe("mergeResult", () => {
    it("should calculate average days remaining", () => {
      const collector = new CertificateCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            subject: "CN=a.com",
            issuer: "CN=CA",
            validFrom: "",
            validTo: "",
            daysRemaining: 30,
            valid: true,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            subject: "CN=a.com",
            issuer: "CN=CA",
            validFrom: "",
            validTo: "",
            daysRemaining: 60,
            valid: true,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.avgDaysRemaining.avg).toBe(45);
      expect(aggregated.validRate.rate).toBe(100);
    });

    it("should calculate valid rate correctly", () => {
      const collector = new CertificateCollector();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            subject: "CN=a.com",
            issuer: "CN=CA",
            validFrom: "",
            validTo: "",
            daysRemaining: 30,
            valid: true,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            subject: "CN=a.com",
            issuer: "CN=CA",
            validFrom: "",
            validTo: "",
            daysRemaining: 0,
            valid: false,
          },
        },
      ];

      let aggregated = collector.mergeResult(undefined, runs[0]);
      aggregated = collector.mergeResult(aggregated, runs[1]);

      expect(aggregated.validRate.rate).toBe(50);
    });
  });

  describe("metadata", () => {
    it("should have correct static properties", () => {
      const collector = new CertificateCollector();

      expect(collector.id).toBe("certificate");
      expect(collector.displayName).toBe("TLS Certificate");
      expect(collector.allowMultiple).toBe(false);
      expect(collector.supportedPlugins).toHaveLength(1);
    });
  });
});
