import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { formatModelError } from "./model-error.logic";

describe("formatModelError", () => {
  test("surfaces an APICallError's status + response body (the masked detail)", () => {
    const error = new APICallError({
      message: "Bad Request",
      url: "https://openrouter.ai/api/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: '{"error":{"code":"invalid_prompt","message":"bad"}}',
    });
    const { userMessage, logDetail } = formatModelError({ error });
    expect(userMessage).toContain("HTTP 400");
    expect(userMessage).toContain("invalid_prompt");
    expect(logDetail.kind).toBe("APICallError");
    expect(logDetail.statusCode).toBe(400);
    expect(logDetail.responseBody).toContain("invalid_prompt");
  });

  test("falls back to the error message when the API error has no body", () => {
    const error = new APICallError({
      message: "upstream timeout",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 504,
    });
    const { userMessage } = formatModelError({ error });
    expect(userMessage).toContain("HTTP 504");
    expect(userMessage).toContain("upstream timeout");
  });

  test("truncates an oversized provider body", () => {
    const huge = "x".repeat(5000);
    const error = new APICallError({
      message: "big",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: huge,
    });
    const { userMessage } = formatModelError({ error });
    expect(userMessage).toContain("(truncated)");
    expect(userMessage.length).toBeLessThan(huge.length);
  });

  test("handles a generic Error without leaking internals", () => {
    const { userMessage, logDetail } = formatModelError({
      error: new Error("something broke"),
    });
    expect(userMessage).toContain("something broke");
    expect(logDetail.kind).toBe("error");
  });

  test("handles a non-Error throw (string / unknown)", () => {
    const { userMessage } = formatModelError({ error: "weird" });
    expect(userMessage.length).toBeGreaterThan(0);
  });
});
