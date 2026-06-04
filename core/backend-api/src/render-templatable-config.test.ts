import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { configString, withConfigMeta } from "./zod-config";
import {
  assertNoSecretTemplatableConflict,
  renderTemplatableConfig,
  renderTemplatePreview,
} from "./render-templatable-config";

const httpLikeSchema = z.object({
  url: configString({ "x-templatable": true }),
  method: z.string(),
  headers: z
    .array(
      z.object({
        name: z.string(),
        value: configString({ "x-templatable": true }),
      }),
    )
    .optional(),
  body: configString({ "x-templatable": true }).optional(),
});

const context = {
  environment: { baseUrl: "https://staging.example.com", tenant: "acme" },
  check: { name: "API health" },
  system: { id: "sys-1" },
};

describe("renderTemplatableConfig", () => {
  test("renders environment.* into url, header values, and body", () => {
    const out = renderTemplatableConfig({
      schema: httpLikeSchema,
      context,
      config: {
        url: "{{ environment.baseUrl }}/healthz",
        method: "GET",
        headers: [
          { name: "Host", value: "{{ environment.baseUrl }}" },
          { name: "X-Tenant", value: "{{ environment.tenant }}" },
        ],
        body: '{"tenant":"{{ environment.tenant }}"}',
      },
    }) as Record<string, unknown>;

    expect(out.url).toBe("https://staging.example.com/healthz");
    expect(out.headers).toEqual([
      { name: "Host", value: "https://staging.example.com" },
      { name: "X-Tenant", value: "acme" },
    ]);
    expect(out.body).toBe('{"tenant":"acme"}');
    // Non-templatable field passed through verbatim.
    expect(out.method).toBe("GET");
  });

  test("non-templatable field with a literal {{ is untouched", () => {
    const out = renderTemplatableConfig({
      schema: httpLikeSchema,
      context,
      config: {
        url: "{{ environment.baseUrl }}",
        // method is NOT templatable; its literal braces must survive verbatim.
        method: "{{ environment.baseUrl }}",
      },
    }) as Record<string, unknown>;

    expect(out.url).toBe("https://staging.example.com");
    expect(out.method).toBe("{{ environment.baseUrl }}");
  });

  test("missing path renders to empty string (strict: false)", () => {
    const out = renderTemplatableConfig({
      schema: httpLikeSchema,
      context: { environment: {}, check: {}, system: {} },
      config: { url: "{{ environment.baseUrl }}/healthz", method: "GET" },
    }) as Record<string, unknown>;

    expect(out.url).toBe("/healthz");
  });

  test("a resolved value containing {{ is not re-interpreted", () => {
    // Simulates secrets-first ordering: a secret already resolved into a value
    // that happens to contain `{{`. The templating pass only renders the
    // x-templatable `url`; the rendered output itself is never re-parsed.
    const out = renderTemplatableConfig({
      schema: httpLikeSchema,
      context: {
        environment: { baseUrl: "https://h/{{ not_a_ref }}" },
        check: {},
        system: {},
      },
      config: { url: "{{ environment.baseUrl }}", method: "GET" },
    }) as Record<string, unknown>;

    // The `{{ not_a_ref }}` came FROM the resolved value, not the template, so
    // it is emitted literally (single-pass render).
    expect(out.url).toBe("https://h/{{ not_a_ref }}");
  });

  test("does not mutate the input config", () => {
    const config = {
      url: "{{ environment.baseUrl }}",
      method: "GET",
      headers: [{ name: "Host", value: "{{ environment.baseUrl }}" }],
    };
    renderTemplatableConfig({ schema: httpLikeSchema, context, config });
    expect(config.url).toBe("{{ environment.baseUrl }}");
    expect(config.headers[0].value).toBe("{{ environment.baseUrl }}");
  });
});

describe("renderTemplatePreview", () => {
  test("renders a single value against a sample context", () => {
    expect(
      renderTemplatePreview({
        value: "{{ environment.baseUrl }}/v1",
        context,
      }),
    ).toBe("https://staging.example.com/v1");
  });

  test("leaves a non-template value untouched", () => {
    expect(
      renderTemplatePreview({ value: "https://static.example", context }),
    ).toBe("https://static.example");
  });
});

describe("assertNoSecretTemplatableConflict", () => {
  test("throws when a field is both x-secret and x-templatable", () => {
    const schema = z.object({
      token: configString({ "x-secret": true, "x-templatable": true }),
    });
    expect(() =>
      assertNoSecretTemplatableConflict({ schema, schemaName: "test" }),
    ).toThrow(/both/);
  });

  test("throws for nested both-flagged field naming the path", () => {
    const schema = z.object({
      headers: z.array(
        z.object({
          value: configString({
            "x-secret-env": true,
            "x-templatable": true,
          }),
        }),
      ),
    });
    expect(() =>
      assertNoSecretTemplatableConflict({ schema, schemaName: "test" }),
    ).toThrow(/headers\[\]\.value/);
  });

  test("passes when secret and templatable are on different fields", () => {
    const schema = z.object({
      token: configString({ "x-secret": true }),
      url: configString({ "x-templatable": true }),
      env: withConfigMeta(z.record(z.string(), z.string()), {
        "x-secret-env": true,
      }),
    });
    expect(() =>
      assertNoSecretTemplatableConflict({ schema, schemaName: "test" }),
    ).not.toThrow();
  });
});
