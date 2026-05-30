import { describe, expect, test } from "bun:test";
import { loadS3ConfigFromEnv } from "./config";

const full = {
  CHECKSTACK_SCRIPT_PACKAGES_S3_ENDPOINT: "https://s3.example.com",
  CHECKSTACK_SCRIPT_PACKAGES_S3_BUCKET: "checkstack",
  CHECKSTACK_SCRIPT_PACKAGES_S3_REGION: "us-east-1",
  CHECKSTACK_SCRIPT_PACKAGES_S3_ACCESS_KEY_ID: "AKIA",
  CHECKSTACK_SCRIPT_PACKAGES_S3_SECRET_ACCESS_KEY: "secret",
  CHECKSTACK_SCRIPT_PACKAGES_S3_FORCE_PATH_STYLE: "true",
};

describe("loadS3ConfigFromEnv", () => {
  test("returns unconfigured when nothing is set", () => {
    expect(loadS3ConfigFromEnv({})).toEqual({ ok: "unconfigured" });
  });

  test("parses a complete config", () => {
    const res = loadS3ConfigFromEnv(full);
    expect(res.ok).toBe(true);
    if (res.ok !== true) throw new Error("expected ok");
    expect(res.config.bucket).toBe("checkstack");
    expect(res.config.forcePathStyle).toBe(true);
    expect(res.config.endpoint).toBe("https://s3.example.com");
  });

  test("reports an error for a partial config instead of silently ignoring", () => {
    const res = loadS3ConfigFromEnv({
      CHECKSTACK_SCRIPT_PACKAGES_S3_BUCKET: "checkstack",
      // missing credentials
    });
    expect(res.ok).toBe(false);
    if (res.ok !== false) throw new Error("expected error");
    expect(res.error).toMatch(/accessKeyId|secretAccessKey/);
  });

  test("forcePathStyle defaults to false when only other fields set", () => {
    const { CHECKSTACK_SCRIPT_PACKAGES_S3_FORCE_PATH_STYLE: _omit, ...rest } =
      full;
    const res = loadS3ConfigFromEnv(rest);
    expect(res.ok).toBe(true);
    if (res.ok !== true) throw new Error("expected ok");
    expect(res.config.forcePathStyle).toBe(false);
  });
});
