import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { securityHeaders } from "./security-headers";

describe("securityHeaders middleware", () => {
  it("should set security headers on response", async () => {
    const app = new Hono();
    app.use("*", securityHeaders());
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");

    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(await res.text()).toBe("ok");
  });
});
