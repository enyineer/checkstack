import { describe, it, expect } from "bun:test";
import {
  INTERNAL_SECRET_PREFIX,
  internalSecretName,
  isInternalSecretName,
} from "./internal-secrets";

describe("internal secret names", () => {
  it("builds a prefixed colon-joined name", () => {
    expect(internalSecretName("script-packages", "registry-auth-token")).toBe(
      `${INTERNAL_SECRET_PREFIX}script-packages:registry-auth-token`,
    );
  });

  it("recognizes internal names and rejects ordinary ones", () => {
    expect(isInternalSecretName(internalSecretName("a", "b"))).toBe(true);
    expect(isInternalSecretName("jira_token")).toBe(false);
    expect(isInternalSecretName("")).toBe(false);
  });
});
