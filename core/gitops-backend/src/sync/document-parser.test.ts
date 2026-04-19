import { describe, it, expect } from "bun:test";
import { parseEntityDocuments, computeHash } from "./document-parser";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";

const VALID_SYSTEM_YAML = `apiVersion: ${CHECKSTACK_API_VERSION}
kind: System
metadata:
  name: payment-service
  title: Payment Service
  description: Handles payments
spec:
  description: A payment processing system`;

const VALID_HEALTHCHECK_YAML = `apiVersion: ${CHECKSTACK_API_VERSION}
kind: Healthcheck
metadata:
  name: payment-db-check
spec:
  strategy: postgres`;

describe("parseEntityDocuments", () => {
  it("parses a single document", () => {
    const result = parseEntityDocuments({ content: VALID_SYSTEM_YAML });
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity.kind).toBe("System");
    expect(result.entities[0].entity.metadata.name).toBe("payment-service");
    expect(result.entities[0].contentHash).toBeString();
    expect(result.entities[0].contentHash).toHaveLength(64); // SHA-256 hex
  });

  it("parses multi-document YAML separated by ---", () => {
    const content = `${VALID_SYSTEM_YAML}\n---\n${VALID_HEALTHCHECK_YAML}`;
    const result = parseEntityDocuments({ content });
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].entity.kind).toBe("System");
    expect(result.entities[1].entity.kind).toBe("Healthcheck");
  });

  it("handles leading --- in multi-doc YAML", () => {
    const content = `---\n${VALID_SYSTEM_YAML}\n---\n${VALID_HEALTHCHECK_YAML}`;
    const result = parseEntityDocuments({ content });
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(2);
  });

  it("skips empty documents (trailing ---)", () => {
    const content = `${VALID_SYSTEM_YAML}\n---\n`;
    const result = parseEntityDocuments({ content });
    expect(result.errors).toHaveLength(0);
    expect(result.entities).toHaveLength(1);
  });

  it("collects validation errors for invalid envelope", () => {
    const content = `kind: System
metadata:
  name: INVALID-UPPERCASE
spec: {}`;
    const result = parseEntityDocuments({ content });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].documentIndex).toBe(0);
    expect(result.errors[0].message).toContain("Validation error");
    expect(result.entities).toHaveLength(0);
  });

  it("parses valid docs and collects errors for invalid ones in same file", () => {
    const content = `${VALID_SYSTEM_YAML}\n---\nkind: Bad\nmetadata:\n  name: UPPERCASE\nspec: {}`;
    const result = parseEntityDocuments({ content });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entity.kind).toBe("System");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].documentIndex).toBe(1);
  });

  it("returns content hashes that are stable for identical content", () => {
    const result1 = parseEntityDocuments({ content: VALID_SYSTEM_YAML });
    const result2 = parseEntityDocuments({ content: VALID_SYSTEM_YAML });
    expect(result1.entities[0].contentHash).toBe(
      result2.entities[0].contentHash,
    );
  });

  it("returns different hashes for different content", () => {
    const modified = VALID_SYSTEM_YAML.replace(
      "Handles payments",
      "Handles refunds",
    );
    const result1 = parseEntityDocuments({ content: VALID_SYSTEM_YAML });
    const result2 = parseEntityDocuments({ content: modified });
    expect(result1.entities[0].contentHash).not.toBe(
      result2.entities[0].contentHash,
    );
  });

  it("handles completely invalid YAML gracefully", () => {
    const content = `{{{not valid yaml at all`;
    const result = parseEntityDocuments({ content });
    expect(result.entities).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("computeHash", () => {
  it("produces a 64-character hex string", () => {
    const hash = computeHash({ input: "hello world" });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[\da-f]+$/);
  });

  it("produces deterministic output", () => {
    expect(computeHash({ input: "test" })).toBe(
      computeHash({ input: "test" }),
    );
  });
});
