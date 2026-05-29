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
});
