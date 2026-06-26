import { describe, expect, test } from "bun:test";
import { CATALOG_CHANGED } from "./signals";

describe("CATALOG_CHANGED signal", () => {
  test("is keyed to the catalog plugin so the auto-invalidator refreshes [[catalog]]", () => {
    // The frontend SignalAutoInvalidator routes a signal to
    // queryClient.invalidateQueries({ queryKey: [[pluginId]] }); this id is the
    // entire reason the catalog page refreshes after an out-of-band write.
    expect(CATALOG_CHANGED.pluginId).toBe("catalog");
    expect(CATALOG_CHANGED.id).toBe("catalog.changed");
  });

  test("payload schema accepts the entity/action descriptor", () => {
    const parsed = CATALOG_CHANGED.payloadSchema.parse({
      entity: "system",
      action: "created",
      id: "sys-1",
    });
    expect(parsed).toEqual({
      entity: "system",
      action: "created",
      id: "sys-1",
    });
    // id is optional (e.g. a bulk membership change).
    expect(
      CATALOG_CHANGED.payloadSchema.parse({
        entity: "membership",
        action: "updated",
      }),
    ).toEqual({ entity: "membership", action: "updated" });
  });
});
