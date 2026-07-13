import { describe, it, expect } from "bun:test";
import type { MetricScrapeTarget } from "@checkstack/metricstream-common";
import {
  buildScrapeTargetCreate,
  buildScrapeTargetUpdate,
  createBearerToken,
  emptyScrapeForm,
  hasSecretInput,
  scrapeFormFromTarget,
  updateBearerToken,
  validateScrapeForm,
  type ScrapeSecretState,
} from "./scrape-form";

const secret = (o: Partial<ScrapeSecretState>): ScrapeSecretState => ({
  value: "",
  stored: false,
  cleared: false,
  ...o,
});

describe("bearer-token secret handling", () => {
  it("create: typed value is sent, blank is omitted", () => {
    expect(createBearerToken(secret({ value: "  tok  " }))).toBe("tok");
    expect(createBearerToken(secret({}))).toBeUndefined();
  });

  it("update: cleared -> null, typed -> string, untouched -> undefined (keep)", () => {
    expect(updateBearerToken(secret({ stored: true, cleared: true }))).toBeNull();
    expect(updateBearerToken(secret({ stored: true, value: "new" }))).toBe("new");
    expect(updateBearerToken(secret({ stored: true }))).toBeUndefined();
  });

  it("update: clearing wins over leftover typed input", () => {
    expect(
      updateBearerToken(secret({ stored: true, value: "x", cleared: true })),
    ).toBeNull();
  });

  it("hasSecretInput reflects trimmed typed content", () => {
    expect(hasSecretInput(secret({ value: "  " }))).toBe(false);
    expect(hasSecretInput(secret({ value: "z" }))).toBe(true);
  });
});

describe("scrapeFormFromTarget", () => {
  it("seeds the secret as stored-but-blank so it reads back masked", () => {
    const target: MetricScrapeTarget = {
      id: "t1",
      streamId: "s1",
      name: "prod",
      url: "https://x/metrics",
      intervalSeconds: 30,
      timeoutMs: 5000,
      enabled: false,
      satelliteId: "sat-1",
      hasBearerToken: true,
      lastScrapeAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const form = scrapeFormFromTarget(target);
    expect(form.secret).toEqual({ value: "", stored: true, cleared: false });
    expect(form.enabled).toBe(false);
    expect(form.intervalSeconds).toBe(30);
    expect(form.satelliteId).toBe("sat-1");
  });

  it("defaults a fresh form to core (null satellite)", () => {
    expect(emptyScrapeForm().satelliteId).toBeNull();
  });
});

describe("validateScrapeForm", () => {
  const base = { ...emptyScrapeForm(), name: "n", url: "https://x/metrics" };
  it("passes a well-formed target", () => {
    expect(validateScrapeForm(base)).toBeNull();
  });
  it("rejects a missing name / url / bad url / out-of-range interval", () => {
    expect(validateScrapeForm({ ...base, name: " " })).toMatch(/name/i);
    expect(validateScrapeForm({ ...base, url: "" })).toMatch(/url/i);
    expect(validateScrapeForm({ ...base, url: "not-a-url" })).toMatch(/valid url/i);
    expect(validateScrapeForm({ ...base, intervalSeconds: 1 })).toMatch(/interval/i);
  });
});

describe("payload builders", () => {
  it("create omits an empty bearer token and trims text", () => {
    const form = { ...emptyScrapeForm(), name: " n ", url: " https://x/m " };
    expect(buildScrapeTargetCreate({ form, streamId: "s1" })).toEqual({
      streamId: "s1",
      name: "n",
      url: "https://x/m",
      intervalSeconds: 60,
      timeoutMs: 10_000,
      enabled: true,
      bearerToken: undefined,
      satelliteId: null,
    });
  });

  it("create carries a chosen satellite binding", () => {
    const form = {
      ...emptyScrapeForm(),
      name: "n",
      url: "https://x/m",
      satelliteId: "sat-9",
    };
    expect(buildScrapeTargetCreate({ form, streamId: "s1" }).satelliteId).toBe(
      "sat-9",
    );
  });

  it("update carries the sentinel + ids + satellite binding", () => {
    const form = {
      ...emptyScrapeForm(),
      name: "n",
      url: "https://x/m",
      secret: secret({ stored: true, cleared: true }),
      satelliteId: "sat-2",
    };
    const out = buildScrapeTargetUpdate({ form, streamId: "s1", targetId: "t1" });
    expect(out.streamId).toBe("s1");
    expect(out.targetId).toBe("t1");
    expect(out.bearerToken).toBeNull();
    expect(out.satelliteId).toBe("sat-2");
  });

  it("update unbinds to core when the form is set to core (null)", () => {
    const form = { ...emptyScrapeForm(), name: "n", url: "https://x/m" };
    expect(
      buildScrapeTargetUpdate({ form, streamId: "s1", targetId: "t1" })
        .satelliteId,
    ).toBeNull();
  });
});
