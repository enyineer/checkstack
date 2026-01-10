import { describe, expect, it, mock } from "bun:test";
import {
  TlsHealthCheckStrategy,
  TlsClient,
  TlsConnection,
  CertificateInfo,
} from "./strategy";

describe("TlsHealthCheckStrategy", () => {
  // Create a valid certificate info (30 days until expiry)
  const createCertInfo = (
    overrides: Partial<{
      subject: string;
      issuer: string;
      issuerOrg: string | undefined;
      validFrom: Date;
      validTo: Date;
    }> = {}
  ): CertificateInfo => {
    const validFrom =
      overrides.validFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const validTo =
      overrides.validTo ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Check if issuerOrg was explicitly set (even to undefined)
    const hasIssuerOrg = "issuerOrg" in overrides;
    const issuerOrg = hasIssuerOrg ? overrides.issuerOrg : "DigiCert Inc";

    return {
      subject: { CN: overrides.subject ?? "example.com" },
      issuer: {
        CN: overrides.issuer ?? "DigiCert",
        O: issuerOrg,
      },
      valid_from: validFrom.toISOString(),
      valid_to: validTo.toISOString(),
    };
  };

  // Helper to create mock TLS client
  const createMockClient = (
    config: {
      authorized?: boolean;
      cert?: CertificateInfo;
      protocol?: string;
      cipher?: string;
      error?: Error;
    } = {}
  ): TlsClient => ({
    connect: mock(() =>
      config.error
        ? Promise.reject(config.error)
        : Promise.resolve({
            authorized: config.authorized ?? true,
            getPeerCertificate: () => config.cert ?? createCertInfo(),
            getProtocol: () => config.protocol ?? "TLSv1.3",
            getCipher: () => (config.cipher ? { name: config.cipher } : null),
            end: mock(() => {}),
          } as TlsConnection)
    ),
  });

  describe("createClient", () => {
    it("should return a connected client", async () => {
      const strategy = new TlsHealthCheckStrategy(createMockClient());

      const connectedClient = await strategy.createClient({
        host: "example.com",
        port: 443,
        timeout: 5000,
        minDaysUntilExpiry: 7,
        rejectUnauthorized: true,
      });

      expect(connectedClient.client).toBeDefined();
      expect(connectedClient.client.exec).toBeDefined();
      expect(connectedClient.close).toBeDefined();

      connectedClient.close();
    });

    it("should throw for connection error during client creation", async () => {
      const strategy = new TlsHealthCheckStrategy(
        createMockClient({ error: new Error("Connection refused") })
      );

      await expect(
        strategy.createClient({
          host: "example.com",
          port: 443,
          timeout: 5000,
          minDaysUntilExpiry: 7,
          rejectUnauthorized: true,
        })
      ).rejects.toThrow("Connection refused");
    });
  });

  describe("client.exec (inspect action)", () => {
    it("should return valid certificate info", async () => {
      const strategy = new TlsHealthCheckStrategy(createMockClient());

      const connectedClient = await strategy.createClient({
        host: "example.com",
        port: 443,
        timeout: 5000,
        minDaysUntilExpiry: 7,
        rejectUnauthorized: true,
      });

      const result = await connectedClient.client.exec({ action: "inspect" });

      expect(result.isValid).toBe(true);
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.subject).toBe("example.com");

      connectedClient.close();
    });

    it("should return invalid for unauthorized certificate", async () => {
      const strategy = new TlsHealthCheckStrategy(
        createMockClient({ authorized: false })
      );

      const connectedClient = await strategy.createClient({
        host: "example.com",
        port: 443,
        timeout: 5000,
        minDaysUntilExpiry: 7,
        rejectUnauthorized: false, // Don't reject to allow connection
      });

      const result = await connectedClient.client.exec({ action: "inspect" });

      expect(result.isValid).toBe(false);

      connectedClient.close();
    });

    it("should detect self-signed certificates", async () => {
      const selfSignedCert = createCertInfo({
        subject: "localhost",
        issuer: "localhost",
        issuerOrg: undefined,
      });

      const strategy = new TlsHealthCheckStrategy(
        createMockClient({ cert: selfSignedCert, authorized: false })
      );

      const connectedClient = await strategy.createClient({
        host: "localhost",
        port: 443,
        timeout: 5000,
        minDaysUntilExpiry: 0,
        rejectUnauthorized: false,
      });

      const result = await connectedClient.client.exec({ action: "inspect" });

      expect(result.isSelfSigned).toBe(true);

      connectedClient.close();
    });
  });

  describe("aggregateResult", () => {
    it("should calculate averages correctly", () => {
      const strategy = new TlsHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "healthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            isValid: true,
            isSelfSigned: false,
            issuer: "DigiCert",
            subject: "example.com",
            validFrom: "2024-01-01",
            validTo: "2025-01-01",
            daysUntilExpiry: 30,
          },
        },
        {
          id: "2",
          status: "healthy" as const,
          latencyMs: 150,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            isValid: true,
            isSelfSigned: false,
            issuer: "DigiCert",
            subject: "example.com",
            validFrom: "2024-01-01",
            validTo: "2025-01-01",
            daysUntilExpiry: 20,
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.avgDaysUntilExpiry).toBe(25);
      expect(aggregated.minDaysUntilExpiry).toBe(20);
      expect(aggregated.invalidCount).toBe(0);
      expect(aggregated.errorCount).toBe(0);
    });

    it("should count invalid and errors", () => {
      const strategy = new TlsHealthCheckStrategy();
      const runs = [
        {
          id: "1",
          status: "unhealthy" as const,
          latencyMs: 100,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: true,
            isValid: false,
            isSelfSigned: false,
            issuer: "",
            subject: "",
            validFrom: "",
            validTo: "",
            daysUntilExpiry: 0,
          },
        },
        {
          id: "2",
          status: "unhealthy" as const,
          latencyMs: 0,
          checkId: "c1",
          timestamp: new Date(),
          metadata: {
            connected: false,
            isValid: false,
            isSelfSigned: false,
            issuer: "",
            subject: "",
            validFrom: "",
            validTo: "",
            daysUntilExpiry: 0,
            error: "Connection refused",
          },
        },
      ];

      const aggregated = strategy.aggregateResult(runs);

      expect(aggregated.invalidCount).toBe(2);
      expect(aggregated.errorCount).toBe(1);
    });
  });
});
