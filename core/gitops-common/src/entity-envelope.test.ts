import { describe, it, expect } from "bun:test";
import {
  entityEnvelopeSchema,
  CHECKSTACK_API_VERSION,
} from "./entity-envelope";

describe("entityEnvelopeSchema", () => {
  it("accepts a valid entity envelope", () => {
    const result = entityEnvelopeSchema.safeParse({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      metadata: {
        name: "payment-service",
        title: "Payment Service",
        description: "Handles payments",
        labels: { team: "platform" },
        annotations: { "pagerduty.com/service-id": "PD123" },
        tags: ["production"],
      },
      spec: { description: "test" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a minimal entity envelope (only required fields)", () => {
    const result = entityEnvelopeSchema.safeParse({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      metadata: { name: "my-system" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects metadata.name with uppercase characters", () => {
    const result = entityEnvelopeSchema.safeParse({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      metadata: { name: "MySystem" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata.name exceeding 63 characters", () => {
    const result = entityEnvelopeSchema.safeParse({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      metadata: { name: "a".repeat(64) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects metadata.name starting with a hyphen", () => {
    const result = entityEnvelopeSchema.safeParse({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      metadata: { name: "-invalid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing apiVersion", () => {
    const result = entityEnvelopeSchema.safeParse({
      kind: "System",
      metadata: { name: "test" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid apiVersion format", () => {
    const result = entityEnvelopeSchema.safeParse({
      apiVersion: "invalid",
      kind: "System",
      metadata: { name: "test" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty kind", () => {
    const result = entityEnvelopeSchema.safeParse({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "",
      metadata: { name: "test" },
    });
    expect(result.success).toBe(false);
  });
});
