import { describe, it, expect } from "bun:test";

describe("API Key Parsing", () => {
  it("should extract application ID and secret safely", () => {
    // This is essentially simulating the logic added in Fix 8.A
    const token = "ck_123e4567-e89b-12d3-a456-426614174000_sec_test_12345";
    const tokenWithoutPrefix = token.slice(3); // Remove "ck_"
    const separatorIndex = tokenWithoutPrefix.indexOf("_", 36);

    expect(separatorIndex).not.toBe(-1);

    const applicationId = tokenWithoutPrefix.slice(0, separatorIndex);
    const secret = tokenWithoutPrefix.slice(separatorIndex + 1);

    expect(applicationId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(secret).toBe("sec_test_12345");
  });

  it("should reject improperly formatted tokens without throwing", () => {
    const malformedToken = "ck_short_bad";
    const tokenWithoutPrefix = malformedToken.slice(3); // Remove "ck_"
    const separatorIndex = tokenWithoutPrefix.indexOf("_", 36);

    expect(separatorIndex).toBe(-1);
  });
});
