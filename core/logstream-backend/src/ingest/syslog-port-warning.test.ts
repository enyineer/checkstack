import { describe, it, expect } from "bun:test";
import { removedSyslogPortEnvWarning } from "./setup";

describe("removedSyslogPortEnvWarning", () => {
  it("returns null when the env var is unset", () => {
    expect(removedSyslogPortEnvWarning({ env: {} })).toBeNull();
  });

  it("returns null when the env var is blank", () => {
    expect(
      removedSyslogPortEnvWarning({ env: { CHECKSTACK_LOGSTREAM_SYSLOG_PORT: "   " } }),
    ).toBeNull();
  });

  it("warns, naming the variable and pointing at the syslog source docs, when it is still set", () => {
    const warning = removedSyslogPortEnvWarning({
      env: { CHECKSTACK_LOGSTREAM_SYSLOG_PORT: "514" },
    });
    expect(warning).not.toBeNull();
    expect(warning).toContain("CHECKSTACK_LOGSTREAM_SYSLOG_PORT");
    expect(warning).toContain("no longer has any effect");
    expect(warning).toContain("/user-guide/guides/ship-logs/");
  });
});
