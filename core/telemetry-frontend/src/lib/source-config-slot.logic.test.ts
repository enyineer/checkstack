import { describe, it, expect } from "bun:test";
import { selectConfigFiller } from "./source-config-slot.logic";

type Filler = { id: string; metadata?: { sourceTypeId?: string } };

const filler = (id: string, sourceTypeId?: string): Filler => ({
  id,
  metadata: sourceTypeId ? { sourceTypeId } : undefined,
});

describe("selectConfigFiller", () => {
  it("returns the filler whose metadata matches the source type", () => {
    const match = selectConfigFiller({
      extensions: [filler("a", "demo.other"), filler("b", "demo.target")],
      sourceTypeId: "demo.target",
    });
    expect(match?.id).toBe("b");
  });

  it("returns null when no filler matches (falls back to DynamicForm)", () => {
    expect(
      selectConfigFiller({
        extensions: [filler("a", "demo.other")],
        sourceTypeId: "demo.target",
      }),
    ).toBeNull();
  });

  it("returns null when there are no fillers at all", () => {
    expect(
      selectConfigFiller({ extensions: [], sourceTypeId: "demo.target" }),
    ).toBeNull();
  });

  it("picks the first registered filler when several match the same type", () => {
    const match = selectConfigFiller({
      extensions: [
        filler("first", "demo.target"),
        filler("second", "demo.target"),
      ],
      sourceTypeId: "demo.target",
    });
    expect(match?.id).toBe("first");
  });

  it("ignores fillers with no metadata", () => {
    expect(
      selectConfigFiller({
        extensions: [filler("no-meta")],
        sourceTypeId: "demo.target",
      }),
    ).toBeNull();
  });
});
