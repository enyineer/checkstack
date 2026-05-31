import { describe, it, expect } from "bun:test";
import { secretResolverRef } from "@checkstack/secrets-backend";
import { connectionStoreRef } from "@checkstack/integration-backend";
import {
  SECRET_RESOLVER_REF_ID,
  CONNECTION_STORE_REF_ID,
} from "./secret-ref-ids";

/**
 * Drift guard: the dispatch core intercepts these service refs by literal
 * id (to avoid a hard dependency cycle). If either ref is renamed, this
 * test fails so run-wide masking can't silently stop capturing values.
 */
describe("secret ref id constants", () => {
  it("match the real secretResolverRef / connectionStoreRef ids", () => {
    expect(SECRET_RESOLVER_REF_ID).toBe(secretResolverRef.id);
    expect(CONNECTION_STORE_REF_ID).toBe(connectionStoreRef.id);
  });
});
