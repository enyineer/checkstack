import { describe, expect, test } from "bun:test";
import { AboutSectionsSlot } from "./slots";

describe("AboutSectionsSlot", () => {
  test("exposes a stable slot id that plugins register against", () => {
    // The id is a public contract: contributing plugins key their extensions
    // on it, so changing it silently detaches every About-page section.
    expect(AboutSectionsSlot.id).toBe("plugin.about.sections");
  });

  test("metadata type is erased at runtime (phantom only)", () => {
    expect(AboutSectionsSlot._metadataType).toBeUndefined();
    expect(AboutSectionsSlot._contextType).toBeUndefined();
  });
});
