import { describe, it, expect } from "bun:test";
import { ORPCError } from "@orpc/server";
import type { RpcClient } from "@checkstack/backend-api";
import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import { assertSatelliteScrapeBindable } from "./binding-auth";

const satellite = (
  overrides: Partial<SatelliteWithStatus> = {},
): SatelliteWithStatus => ({
  id: "sat-1",
  name: "EU West",
  region: "eu-west-1",
  tags: {},
  capabilities: ["scrape"],
  status: "online",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

/** A client whose satellite `getSatellite` behaves as supplied. */
function fakeClient(
  getSatellite: (input: { id: string }) => Promise<SatelliteWithStatus | null>,
): RpcClient {
  return {
    forPlugin: () => ({ getSatellite }) as never,
  };
}

/** Capture the thrown ORPCError so we can assert its code. */
async function expectReject(promise: Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    return error as ORPCError<string, unknown>;
  }
  throw new Error("expected the call to reject");
}

describe("assertSatelliteScrapeBindable", () => {
  it("propagates FORBIDDEN when the caller cannot read the satellite", async () => {
    // getSatellite is satellite.read-gated; as the caller it throws FORBIDDEN.
    const client = fakeClient(async () => {
      throw new ORPCError("FORBIDDEN", { message: "no read access" });
    });
    const error = await expectReject(
      assertSatelliteScrapeBindable({ client, satelliteId: "sat-x" }),
    );
    expect(error.code).toBe("FORBIDDEN");
  });

  it("rejects a non-existent satellite with BAD_REQUEST", async () => {
    const client = fakeClient(async () => null);
    const error = await expectReject(
      assertSatelliteScrapeBindable({ client, satelliteId: "ghost" }),
    );
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toMatch(/not found/i);
  });

  it("rejects a satellite that does not advertise scrape with BAD_REQUEST", async () => {
    const client = fakeClient(async () =>
      satellite({ capabilities: ["telemetry", "syslog"] }),
    );
    const error = await expectReject(
      assertSatelliteScrapeBindable({ client, satelliteId: "sat-1" }),
    );
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toMatch(/scraping/i);
  });

  it("resolves for a readable, scrape-capable satellite", async () => {
    const client = fakeClient(async () => satellite({ capabilities: ["scrape"] }));
    await expect(
      assertSatelliteScrapeBindable({ client, satelliteId: "sat-1" }),
    ).resolves.toBeUndefined();
  });
});
