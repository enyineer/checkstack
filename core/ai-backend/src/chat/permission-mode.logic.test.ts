import { describe, expect, test } from "bun:test";
import type { AiPermissionMode, AiToolEffect } from "@checkstack/ai-common";
import { decideToolDisposition } from "./permission-mode.logic";

const MODES: AiPermissionMode[] = ["approve", "auto"];
const EFFECTS: AiToolEffect[] = ["read", "mutate", "destructive"];

describe("decideToolDisposition — 3-tier gating", () => {
  test("read ALWAYS auto-runs, in BOTH modes (mode never gates reads)", () => {
    for (const mode of MODES) {
      expect(decideToolDisposition({ effect: "read", mode })).toBe("auto-run");
    }
  });

  test("mutate INHERITS the mode: auto -> auto-apply, approve -> propose", () => {
    expect(decideToolDisposition({ effect: "mutate", mode: "auto" })).toBe(
      "auto-apply",
    );
    expect(decideToolDisposition({ effect: "mutate", mode: "approve" })).toBe(
      "propose",
    );
  });

  describe("SECURITY INVARIANT: destructive can NEVER auto-apply", () => {
    test("destructive ALWAYS proposes, in BOTH modes", () => {
      for (const mode of MODES) {
        expect(decideToolDisposition({ effect: "destructive", mode })).toBe(
          "propose",
        );
      }
    });

    test("NO permission-mode value changes a destructive tool's requirement for a human apply", () => {
      // The mode is the ONLY parameter that could differ; assert it has no
      // effect on a destructive tool's disposition. If a future change let the
      // mode leak into the destructive branch, the two values would diverge.
      const approveDisposition = decideToolDisposition({
        effect: "destructive",
        mode: "approve",
      });
      const autoDisposition = decideToolDisposition({
        effect: "destructive",
        mode: "auto",
      });
      expect(autoDisposition).toBe(approveDisposition);
      expect(autoDisposition).toBe("propose");
    });

    test("no (effect, mode) pair routes a destructive tool to auto-apply", () => {
      for (const mode of MODES) {
        expect(
          decideToolDisposition({ effect: "destructive", mode }),
        ).not.toBe("auto-apply");
      }
    });

    test("auto-apply is reachable ONLY via (mutate, auto)", () => {
      const autoApplyPairs: Array<{ effect: AiToolEffect; mode: AiPermissionMode }> =
        [];
      for (const effect of EFFECTS) {
        for (const mode of MODES) {
          if (decideToolDisposition({ effect, mode }) === "auto-apply") {
            autoApplyPairs.push({ effect, mode });
          }
        }
      }
      expect(autoApplyPairs).toEqual([{ effect: "mutate", mode: "auto" }]);
    });
  });
});
