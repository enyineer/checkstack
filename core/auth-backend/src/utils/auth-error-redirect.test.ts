import { describe, it, expect } from "bun:test";
import {
  buildAuthErrorUrl,
  encodeAuthError,
  redirectToAuthError,
} from "./auth-error-redirect";

const FRONTEND = "https://app.test";

describe("encodeAuthError", () => {
  it("replaces every space with an underscore (better-auth convention)", () => {
    expect(encodeAuthError("Invalid login attempt")).toBe(
      "Invalid_login_attempt",
    );
  });

  it("leaves a message without spaces unchanged", () => {
    expect(encodeAuthError("unauthorized")).toBe("unauthorized");
  });

  it("collapses nothing - each space becomes exactly one underscore", () => {
    expect(encodeAuthError("a  b")).toBe("a__b");
  });
});

describe("buildAuthErrorUrl", () => {
  it("builds the error path with the space-to-underscore message", () => {
    // encodeURIComponent leaves underscores intact, so spaces survive as "_".
    expect(buildAuthErrorUrl("Access denied", FRONTEND)).toBe(
      "https://app.test/auth/error?error=Access_denied",
    );
  });

  it("percent-encodes characters that are unsafe in a query value", () => {
    // '&' and '=' would otherwise break out of the query parameter; the second
    // encoding pass escapes them after spaces have become underscores.
    expect(buildAuthErrorUrl("a & b = c", FRONTEND)).toBe(
      "https://app.test/auth/error?error=a_%26_b_%3D_c",
    );
  });

  it("guards against query-injection via an open-redirect-style payload", () => {
    const url = buildAuthErrorUrl("x&redirect=https://evil.test", FRONTEND);
    expect(url).toBe(
      "https://app.test/auth/error?error=x%26redirect%3Dhttps%3A%2F%2Fevil.test",
    );
    // The injected '&' is encoded, so it cannot start a new query parameter.
    expect(url).not.toContain("&redirect=");
  });
});

describe("redirectToAuthError", () => {
  it("returns a 302 redirect to the built error url", () => {
    const response = redirectToAuthError("Session expired", FRONTEND);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://app.test/auth/error?error=Session_expired",
    );
  });
});
