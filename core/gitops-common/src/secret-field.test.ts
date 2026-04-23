import { describe, it, expect } from "bun:test";
import {
  SECRET_TEMPLATE_REGEX,
  secretNameSchema,
  collectSecretNames,
  secretTemplateSchema,
} from "./secret-field";

describe("SECRET_TEMPLATE_REGEX", () => {
  it("matches a simple secret template", () => {
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    const match = SECRET_TEMPLATE_REGEX.exec("${{ secrets.DB_PASS }}");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("DB_PASS");
  });

  it("matches templates with extra whitespace", () => {
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    const match = SECRET_TEMPLATE_REGEX.exec("${{  secrets.MY_KEY  }}");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("MY_KEY");
  });

  it("matches hyphenated secret names", () => {
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    const match = SECRET_TEMPLATE_REGEX.exec("${{ secrets.prod-db-pass }}");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("prod-db-pass");
  });

  it("matches multiple templates in one string", () => {
    const str =
      "postgres://${{ secrets.DB_USER }}:${{ secrets.DB_PASS }}@host/db";
    const matches: string[] = [];
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SECRET_TEMPLATE_REGEX.exec(str)) !== null) {
      matches.push(match[1]);
    }
    expect(matches).toEqual(["DB_USER", "DB_PASS"]);
  });

  it("does not match plain strings", () => {
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    expect(SECRET_TEMPLATE_REGEX.exec("just a string")).toBeNull();
  });

  it("does not match malformed templates", () => {
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    expect(SECRET_TEMPLATE_REGEX.exec("${ secrets.WRONG }")).toBeNull();
    SECRET_TEMPLATE_REGEX.lastIndex = 0;
    expect(SECRET_TEMPLATE_REGEX.exec("${{ notSecrets.WRONG }}")).toBeNull();
  });
});

describe("secretTemplateSchema", () => {
  it("accepts a valid template string", () => {
    const result = secretTemplateSchema.safeParse("${{ secrets.MY_SECRET }}");
    expect(result.success).toBe(true);
  });

  it("rejects a plain string without template", () => {
    const result = secretTemplateSchema.safeParse("just-a-string");
    expect(result.success).toBe(false);
  });
});

describe("collectSecretNames", () => {
  it("extracts a single secret from a top-level string", () => {
    const result = collectSecretNames({
      value: { password: "${{ secrets.DB_PASS }}" },
    });
    expect(result).toEqual(["DB_PASS"]);
  });

  it("returns empty array when no secrets are referenced", () => {
    const result = collectSecretNames({
      value: { host: "localhost", port: 5432 },
    });
    expect(result).toEqual([]);
  });

  it("extracts secrets from nested objects", () => {
    const result = collectSecretNames({
      value: {
        connection: {
          host: "db.internal",
          password: "${{ secrets.NESTED_PASS }}",
        },
      },
    });
    expect(result).toEqual(["NESTED_PASS"]);
  });

  it("extracts secrets from arrays", () => {
    const result = collectSecretNames({
      value: {
        credentials: [
          { name: "db", secret: "${{ secrets.DB_PASS }}" },
          { name: "api", secret: "${{ secrets.API_KEY }}" },
        ],
      },
    });
    expect(result).toEqual(["DB_PASS", "API_KEY"]);
  });

  it("extracts multiple secrets from a single interpolated string", () => {
    const result = collectSecretNames({
      value: {
        url: "postgres://${{ secrets.DB_USER }}:${{ secrets.DB_PASS }}@host/db",
      },
    });
    expect(result).toEqual(["DB_USER", "DB_PASS"]);
  });

  it("deduplicates secret names", () => {
    const result = collectSecretNames({
      value: {
        primary: "${{ secrets.SHARED }}",
        secondary: "${{ secrets.SHARED }}",
      },
    });
    expect(result).toEqual(["SHARED"]);
  });

  it("handles null and undefined values gracefully", () => {
    const result = collectSecretNames({
      value: { a: null, b: undefined, c: "${{ secrets.VALID }}" },
    });
    expect(result).toEqual(["VALID"]);
  });

  it("ignores non-string primitives", () => {
    const result = collectSecretNames({
      value: { num: 42, bool: true, str: "${{ secrets.ONLY_THIS }}" },
    });
    expect(result).toEqual(["ONLY_THIS"]);
  });
});

describe("secretNameSchema", () => {
  it.each(["DB_PASS", "my-secret", "ApiKey123", "a", "prod_db_pass_v2"])("accepts valid name: %s", (name) => {
    expect(secretNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    "has space",
    "has\ttab",
    "123starts-with-digit",
    "has.dot",
    "no@special",
    "no/slashes",
    "${{ secrets.NOPE }}",
    "",
  ])("rejects invalid name: %s", (name) => {
    expect(secretNameSchema.safeParse(name).success).toBe(false);
  });

  it("rejects names exceeding 63 characters", () => {
    const longName = "A".repeat(64);
    expect(secretNameSchema.safeParse(longName).success).toBe(false);
  });

  it("accepts names at the 63-character limit", () => {
    const maxName = "A".repeat(63);
    expect(secretNameSchema.safeParse(maxName).success).toBe(true);
  });
});
