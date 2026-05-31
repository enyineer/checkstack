import { describe, it, expect } from "bun:test";
import {
  buildIndexDdl,
  indexName,
  sanitizeIdentifier,
} from "./index-ddl";

describe("index-ddl", () => {
  it("sanitizes identifiers to a safe charset", () => {
    expect(sanitizeIdentifier("catalog-system")).toBe("catalog_system");
    expect(sanitizeIdentifier("By Status!")).toBe("by_status_");
    expect(sanitizeIdentifier("9lives")).toBe("_9lives");
  });

  it("builds the namespaced index name", () => {
    expect(indexName({ kind: "incident", name: "by_status" })).toBe(
      "entity_state_incident_by_status_idx",
    );
  });

  it("builds a single-field expression index, partial on kind", () => {
    const ddl = buildIndexDdl({
      kind: "incident",
      spec: { name: "by_status", fields: ["status"] },
    });
    expect(ddl).toBe(
      'CREATE INDEX IF NOT EXISTS "entity_state_incident_by_status_idx" ON "entity_state" ((state->>\'status\')) WHERE "kind" = \'incident\'',
    );
  });

  it("builds a composite expression index", () => {
    const ddl = buildIndexDdl({
      kind: "incident",
      spec: { name: "by_status_severity", fields: ["status", "severity"] },
    });
    expect(ddl).toContain("(state->>'status'), (state->>'severity')");
  });

  it("escapes single quotes in the kind literal", () => {
    const ddl = buildIndexDdl({
      kind: "o'kind",
      spec: { name: "x", fields: ["f"] },
    });
    expect(ddl).toContain("WHERE \"kind\" = 'o''kind'");
  });
});
