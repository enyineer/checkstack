import { describe, expect, it } from "bun:test";
import { SHELL_ENV_PREFIX, toShellEnvKey } from "./shell-env";

describe("toShellEnvKey", () => {
  it("prefixes, uppercases, and underscores a dotted scope path", () => {
    expect(toShellEnvKey("trigger.payload.title")).toBe(
      "CHECKSTACK_TRIGGER_PAYLOAD_TITLE",
    );
  });

  it("collapses the dots inside a dotted artifact type", () => {
    expect(toShellEnvKey("artifact.jira.issue.key")).toBe(
      "CHECKSTACK_ARTIFACT_JIRA_ISSUE_KEY",
    );
  });

  it("collapses any run of non-alphanumeric characters to a single underscore", () => {
    expect(toShellEnvKey("var.my-weird key")).toBe("CHECKSTACK_VAR_MY_WEIRD_KEY");
  });

  it("trims leading and trailing separators", () => {
    expect(toShellEnvKey(".trigger.event.")).toBe("CHECKSTACK_TRIGGER_EVENT");
  });

  it("uses the exported prefix constant", () => {
    expect(toShellEnvKey("x").startsWith(SHELL_ENV_PREFIX)).toBe(true);
  });

  it("handles long runs of separators without polynomial backtracking", () => {
    // Guards against ReDoS reintroduction in the trim step: a long run of
    // separator-only input must trim to an empty body quickly.
    const start = performance.now();
    expect(toShellEnvKey(`${".".repeat(100_000)}a`)).toBe("CHECKSTACK_A");
    expect(toShellEnvKey(".".repeat(100_000))).toBe("CHECKSTACK_");
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
