import { describe, expect, test } from "bun:test";
import { buildShellRunContextEnv } from "../collector-script-test";
import { HEALTHCHECK_SHELL_ENV } from "@checkstack/ai-backend";

/**
 * Drift guard (OQ-2): the static `HEALTHCHECK_SHELL_ENV` descriptor table is
 * hand-maintained in ai-backend (cross-plugin import is deliberately avoided in
 * the runtime code). This test asserts every reserved `CHECKSTACK_*` var the
 * real producer (`buildShellRunContextEnv`) emits for a representative sample
 * context is described in the static table. If the producer gains a new
 * reserved var, this test fails until the table is updated.
 */
describe("HEALTHCHECK_SHELL_ENV drift guard", () => {
  test("the static table describes every reserved var the producer emits", () => {
    const produced = buildShellRunContextEnv({
      check: { id: "c1", name: "Check One", intervalSeconds: 60 },
      system: { id: "s1", name: "System One" },
      environment: {
        id: "e1",
        name: "prod",
        // A custom field exercises the CHECKSTACK_ENV_<FIELD> derivation.
        fields: { region: "eu-central-1" },
      },
    });

    const tableNames = new Set(HEALTHCHECK_SHELL_ENV.map((v) => v.name));
    // The dynamic per-field var is covered by the wildcard descriptor.
    tableNames.add("CHECKSTACK_ENV_REGION");

    for (const producedName of Object.keys(produced)) {
      expect(tableNames.has(producedName)).toBe(true);
    }
    // And the well-known reserved names must each be present verbatim.
    for (const reserved of [
      "CHECKSTACK_CHECK_ID",
      "CHECKSTACK_CHECK_NAME",
      "CHECKSTACK_CHECK_INTERVAL_SECONDS",
      "CHECKSTACK_SYSTEM_ID",
      "CHECKSTACK_SYSTEM_NAME",
      "CHECKSTACK_ENV_ID",
      "CHECKSTACK_ENV_NAME",
    ]) {
      expect(Object.keys(produced)).toContain(reserved);
      expect(HEALTHCHECK_SHELL_ENV.some((v) => v.name === reserved)).toBe(true);
    }
  });
});
