import { describe, expect, test } from "bun:test";
import { integrityToKey, keyToIntegrity, S3_KEY_PREFIX } from "./key";

describe("integrity <-> S3 key", () => {
  test("round-trips an SRI integrity with special chars", () => {
    const integrity = "sha512-AbC+/def==";
    const key = integrityToKey(integrity);
    expect(key.startsWith(S3_KEY_PREFIX)).toBe(true);
    expect(key.slice(S3_KEY_PREFIX.length)).toMatch(/^[a-f0-9]+$/);
    expect(keyToIntegrity(key)).toBe(integrity);
  });

  test("rejects keys outside the prefix", () => {
    expect(keyToIntegrity("other/thing")).toBeUndefined();
  });

  test("rejects non-hex payloads", () => {
    expect(keyToIntegrity(`${S3_KEY_PREFIX}zzz`)).toBeUndefined();
  });
});
