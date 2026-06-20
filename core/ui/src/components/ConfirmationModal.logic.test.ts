import { describe, expect, it } from "bun:test";
import {
  confirmButtonVariant,
  confirmationVariantStyles,
  isConfirmPhraseSatisfied,
} from "./ConfirmationModal";

describe("ConfirmationModal - confirm button variant mapping", () => {
  it("maps the danger variant to the shared destructive Button variant", () => {
    // The whole point of the rebuild: the confirm button must go through the
    // shared Button variant system, not a re-implemented class string, so a
    // token change to destructive buttons reaches every confirmation.
    expect(confirmButtonVariant("danger")).toBe("destructive");
  });

  it("maps warning and info to the primary variant (no dedicated variants)", () => {
    expect(confirmButtonVariant("warning")).toBe("primary");
    expect(confirmButtonVariant("info")).toBe("primary");
  });
});

describe("ConfirmationModal - variant styles use semantic tokens", () => {
  it("uses token classes (never hardcoded colors) for every variant", () => {
    for (const styles of Object.values(confirmationVariantStyles)) {
      expect(styles.icon).toMatch(/text-(destructive|warning|info)/);
      expect(styles.iconBg).toMatch(/bg-(destructive|warning|info)\/10/);
    }
  });

  it("only warning and info carry a confirmClassName override", () => {
    expect(confirmationVariantStyles.danger.confirmClassName).toBeUndefined();
    expect(confirmationVariantStyles.warning.confirmClassName).toContain(
      "bg-warning",
    );
    expect(confirmationVariantStyles.info.confirmClassName).toContain(
      "bg-info",
    );
  });
});

describe("ConfirmationModal - typed-phrase gate predicate", () => {
  it("is satisfied with no phrase regardless of typed value", () => {
    // Backward compatibility: without a phrase, the confirm button must enable
    // exactly as before (no input rendered, no gate).
    expect(
      isConfirmPhraseSatisfied({ confirmPhrase: undefined, typedValue: "" }),
    ).toBe(true);
    expect(
      isConfirmPhraseSatisfied({
        confirmPhrase: undefined,
        typedValue: "anything",
      }),
    ).toBe(true);
  });

  it("is unsatisfied while the typed value does not exactly match", () => {
    expect(
      isConfirmPhraseSatisfied({ confirmPhrase: "my-plugin", typedValue: "" }),
    ).toBe(false);
    expect(
      isConfirmPhraseSatisfied({
        confirmPhrase: "my-plugin",
        typedValue: "my-plugi",
      }),
    ).toBe(false);
    // Case- and whitespace-sensitive: must be an exact match.
    expect(
      isConfirmPhraseSatisfied({
        confirmPhrase: "my-plugin",
        typedValue: "My-Plugin",
      }),
    ).toBe(false);
    expect(
      isConfirmPhraseSatisfied({
        confirmPhrase: "my-plugin",
        typedValue: " my-plugin ",
      }),
    ).toBe(false);
  });

  it("is satisfied only on an exact match", () => {
    expect(
      isConfirmPhraseSatisfied({
        confirmPhrase: "my-plugin",
        typedValue: "my-plugin",
      }),
    ).toBe(true);
  });

  it("treats an empty-string phrase as already satisfied (no real gate)", () => {
    expect(
      isConfirmPhraseSatisfied({ confirmPhrase: "", typedValue: "" }),
    ).toBe(true);
  });
});
