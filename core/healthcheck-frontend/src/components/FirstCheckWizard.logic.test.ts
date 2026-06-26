import { describe, expect, test } from "bun:test";
import {
  HTTP_REQUEST_COLLECTOR_ID,
  HTTP_STRATEGY_ID,
  buildHttpCheckConfiguration,
  resolveCheckName,
} from "./FirstCheckWizard.logic";

describe("resolveCheckName", () => {
  test("uses the explicit check name when provided", () => {
    expect(
      resolveCheckName({ checkName: "  My check  ", systemName: "Payments" }),
    ).toBe("My check");
  });

  test("derives a default from the system name when blank", () => {
    expect(resolveCheckName({ checkName: "  ", systemName: "Payments API" })).toBe(
      "Payments API reachability",
    );
  });

  test("is empty when neither is provided (blocks submission)", () => {
    expect(resolveCheckName({ checkName: "", systemName: "  " })).toBe("");
  });
});

describe("buildHttpCheckConfiguration", () => {
  test("builds a minimal HTTP check pointed at the URL with a statusCode assertion", () => {
    const config = buildHttpCheckConfiguration({
      url: "  https://api.example.com/healthz  ",
      checkName: "",
      systemName: "Payments API",
      intervalSeconds: 60,
      collectorId: "collector-1",
    });

    expect(config.name).toBe("Payments API reachability");
    expect(config.strategyId).toBe(HTTP_STRATEGY_ID);
    expect(config.intervalSeconds).toBe(60);
    expect(config.config).toEqual({});

    expect(config.collectors).toHaveLength(1);
    const collector = config.collectors![0];
    expect(collector.id).toBe("collector-1");
    expect(collector.collectorId).toBe(HTTP_REQUEST_COLLECTOR_ID);
    // URL is trimmed before it reaches the collector config.
    expect(collector.config).toEqual({ url: "https://api.example.com/healthz" });
    // The canonical assertion field/operator (statusCode equals 200).
    expect(collector.assertions).toEqual([
      { field: "statusCode", operator: "equals", value: 200 },
    ]);
  });
});
