import { describe, expect, it } from "bun:test";
import {
  connectionToneStyles,
  presentConnectionStatus,
} from "./connectionStatus.logic";

describe("presentConnectionStatus", () => {
  it("maps a missing test result to the resting unknown state", () => {
    expect(presentConnectionStatus({ testResult: undefined })).toEqual({
      label: "Untested",
      tone: "unknown",
    });
  });

  it("maps a successful test to the ok 'Connected' state", () => {
    expect(
      presentConnectionStatus({ testResult: { success: true } }),
    ).toEqual({ label: "Connected", tone: "ok" });
  });

  it("maps a failed test to the down 'Failed' state", () => {
    expect(
      presentConnectionStatus({
        testResult: { success: false, message: "nope" },
      }),
    ).toEqual({ label: "Failed", tone: "down" });
  });
});

describe("connectionToneStyles", () => {
  it("returns distinct class sets per tone", () => {
    const ok = connectionToneStyles({ tone: "ok" });
    const down = connectionToneStyles({ tone: "down" });
    const unknown = connectionToneStyles({ tone: "unknown" });

    expect(ok.dot).toBe("bg-status-ok");
    expect(down.dot).toBe("bg-status-down");
    expect(unknown.dot).toBe("bg-muted-foreground");
    expect(ok.accent).not.toBe(down.accent);
  });
});
