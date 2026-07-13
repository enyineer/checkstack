import { describe, it, expect } from "bun:test";
import type { IngestAuthenticator } from "../auth";
import { PreAuthRateLimiter } from "../rate-limit";
import { authenticateRequest } from "./authenticate";

const GOOD = "ckls_s_secret";

function auth(): { auth: IngestAuthenticator; verifyCalls: () => number } {
  let verifyCalls = 0;
  return {
    verifyCalls: () => verifyCalls,
    auth: {
      verify: async (token) => {
        verifyCalls += 1;
        return token === GOOD
          ? { ok: true, streamId: "s1", tokenId: "t1" }
          : { ok: false, reason: "unknown" };
      },
      clearNegative: async () => {},
    },
  };
}

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/logstream/ingest", {
    method: "POST",
    headers,
  });
}

describe("authenticateRequest pre-auth limiter", () => {
  it("resolves the stream for a valid token", async () => {
    const { auth: a } = auth();
    const result = await authenticateRequest({
      request: req({ authorization: `Bearer ${GOOD}`, "x-forwarded-for": "1.1.1.1" }),
      auth: a,
      preAuthLimiter: new PreAuthRateLimiter(),
    });
    expect(result).toEqual({ streamId: "s1", tokenId: "t1" });
  });

  it("401s an unknown token and counts it against the IP budget", async () => {
    const { auth: a } = auth();
    const limiter = new PreAuthRateLimiter(2);
    const request = () =>
      req({ authorization: "Bearer ckls_bad_x", "x-forwarded-for": "9.9.9.9" });

    const first = await authenticateRequest({ request: request(), auth: a, preAuthLimiter: limiter });
    expect(first).toBeInstanceOf(Response);
    expect((first as Response).status).toBe(401);
  });

  it("429s further requests once the IP exhausts its budget, without hitting verify", async () => {
    const { auth: a, verifyCalls } = auth();
    const limiter = new PreAuthRateLimiter(2); // 2 failures/min/IP
    const bad = () => req({ authorization: "Bearer ckls_bad_x", "x-forwarded-for": "9.9.9.9" });

    // Two failures consume the budget.
    await authenticateRequest({ request: bad(), auth: a, preAuthLimiter: limiter });
    await authenticateRequest({ request: bad(), auth: a, preAuthLimiter: limiter });
    const callsAfterTwo = verifyCalls();

    // Third request is short-circuited to 429 BEFORE auth.verify runs.
    const blocked = await authenticateRequest({ request: bad(), auth: a, preAuthLimiter: limiter });
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(429);
    expect((blocked as Response).headers.get("retry-after")).toBeTruthy();
    expect(verifyCalls()).toBe(callsAfterTwo); // no extra DB/verify call
  });

  it("does not penalize a valid token from a busy IP that had prior failures", async () => {
    const { auth: a } = auth();
    const limiter = new PreAuthRateLimiter(5);
    const ip = "5.5.5.5";
    // A few failures, still under budget.
    await authenticateRequest({
      request: req({ authorization: "Bearer ckls_bad_x", "x-forwarded-for": ip }),
      auth: a,
      preAuthLimiter: limiter,
    });
    // A valid token still authenticates and does NOT increment the failure count.
    const ok = await authenticateRequest({
      request: req({ authorization: `Bearer ${GOOD}`, "x-forwarded-for": ip }),
      auth: a,
      preAuthLimiter: limiter,
    });
    expect(ok).toEqual({ streamId: "s1", tokenId: "t1" });
  });

  it("401s a missing token and counts it against the budget", async () => {
    const { auth: a } = auth();
    const limiter = new PreAuthRateLimiter(1);
    const noToken = () => req({ "x-forwarded-for": "7.7.7.7" });

    const first = await authenticateRequest({ request: noToken(), auth: a, preAuthLimiter: limiter });
    expect((first as Response).status).toBe(401);
    // Budget of 1 now spent; next is blocked.
    const second = await authenticateRequest({ request: noToken(), auth: a, preAuthLimiter: limiter });
    expect((second as Response).status).toBe(429);
  });
});

describe("unauthorizedMessage", () => {
  it("tells the operator to retry a possibly-fresh token within 60 seconds", async () => {
    const { auth: a } = auth();
    const result = await authenticateRequest({
      request: req({ authorization: "Bearer ckls_bad_x", "x-forwarded-for": "2.2.2.2" }),
      auth: a,
      preAuthLimiter: new PreAuthRateLimiter(),
    });
    expect(result).toBeInstanceOf(Response);
    const body = (await (result as Response).json()) as { error: string };
    expect((result as Response).status).toBe(401);
    expect(body.error).toContain("retry in up to 60 seconds");
    expect(body.error).toContain("minted within the last minute");
  });

  it("names revocation explicitly for a revoked token", async () => {
    const revokedAuth: IngestAuthenticator = {
      verify: async () => ({ ok: false, reason: "revoked" }),
    };
    const result = await authenticateRequest({
      request: req({ authorization: "Bearer ckls_gone_x", "x-forwarded-for": "3.3.3.3" }),
      auth: revokedAuth,
      preAuthLimiter: new PreAuthRateLimiter(),
    });
    const body = (await (result as Response).json()) as { error: string };
    expect(body.error).toContain("revoked");
    expect(body.error).not.toContain("retry in up to 60 seconds");
  });
});
