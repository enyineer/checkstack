import { describe, expect, test } from "bun:test";
import { createCheckstackClient } from "../src/client.ts";
import { defineHealthCheck } from "../src/healthcheck.ts";
import { defineIntegration } from "../src/integration.ts";

describe("createCheckstackClient", () => {
  test("builds a client with one entry per plugin id", () => {
    const client = createCheckstackClient({ baseUrl: "https://host/rest" });

    // A representative spread across the plugin surface, including the
    // hyphenated id which must be a quoted key.
    expect(client.healthcheck).toBeDefined();
    expect(client.integration).toBeDefined();
    expect(client.automation).toBeDefined();
    expect(client["script-packages"]).toBeDefined();
    expect(client.auth).toBeDefined();
  });

  test("accepts custom headers without throwing", () => {
    const client = createCheckstackClient({
      baseUrl: "https://host/rest/",
      headers: { authorization: "Bearer token" },
    });
    expect(client.tips).toBeDefined();
  });
});

describe("script helpers (identity runtime)", () => {
  test("defineHealthCheck returns its argument unchanged", () => {
    const result = { success: true, value: 42 };
    expect(defineHealthCheck(result)).toBe(result);

    const fn = () => ({ success: false, message: "down" });
    expect(defineHealthCheck(fn)).toBe(fn);
  });

  test("defineIntegration returns its argument unchanged", () => {
    const result = { id: "ticket-1" };
    expect(defineIntegration(result)).toBe(result);

    const fn = async () => ({ externalId: "x" });
    expect(defineIntegration(fn)).toBe(fn);
  });
});
