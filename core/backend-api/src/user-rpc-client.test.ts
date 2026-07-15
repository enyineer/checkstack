import { describe, expect, test } from "bun:test";
import {
  createUserScopedRpcClient,
  forwardableAuthHeadersFrom,
} from "./user-rpc-client";

describe("forwardableAuthHeadersFrom", () => {
  test("forwards ONLY the session cookie and bearer Authorization", () => {
    const headers = new Headers({
      cookie: "session=abc",
      authorization: "Bearer xyz",
      // Must NOT be forwarded - only auth-bearing headers are.
      "x-forwarded-for": "10.0.0.1",
      "content-type": "application/json",
    });
    expect(forwardableAuthHeadersFrom(headers)).toEqual({
      cookie: "session=abc",
      authorization: "Bearer xyz",
    });
  });

  test("omits absent headers (no empty values)", () => {
    expect(forwardableAuthHeadersFrom(new Headers({ cookie: "s=1" }))).toEqual({
      cookie: "s=1",
    });
    expect(
      forwardableAuthHeadersFrom(new Headers({ authorization: "Bearer t" })),
    ).toEqual({ authorization: "Bearer t" });
  });

  test("returns an empty object for undefined or empty headers", () => {
    expect(forwardableAuthHeadersFrom(undefined)).toEqual({});
    expect(forwardableAuthHeadersFrom(new Headers())).toEqual({});
  });
});

describe("createUserScopedRpcClient", () => {
  test("returns an RpcClient with a forPlugin accessor (no network until used)", () => {
    const client = createUserScopedRpcClient({
      internalUrl: "http://localhost:3000",
      forwardHeaders: { cookie: "session=abc" },
    });
    expect(typeof client.forPlugin).toBe("function");
  });
});
