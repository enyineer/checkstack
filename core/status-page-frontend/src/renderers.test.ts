import { describe, expect, it } from "bun:test";
import { mergeWidgetRenderers, type WidgetRenderer } from "./renderer-map";

const Builtin: WidgetRenderer = () => null;
const Plugin: WidgetRenderer = () => null;
const Impostor: WidgetRenderer = () => null;

describe("mergeWidgetRenderers", () => {
  it("includes every built-in renderer", () => {
    const map = mergeWidgetRenderers({ "statuspage.text": Builtin }, []);
    expect(map.get("statuspage.text")).toBe(Builtin);
  });

  it("adds plugin-contributed renderers under their widget-type id", () => {
    const map = mergeWidgetRenderers({ "statuspage.text": Builtin }, [
      { widgetTypeId: "myplugin.latency", component: Plugin },
    ]);
    expect(map.get("myplugin.latency")).toBe(Plugin);
    expect(map.get("statuspage.text")).toBe(Builtin);
  });

  it("does NOT let a contribution shadow a built-in (the statuspage.* namespace is reserved)", () => {
    const map = mergeWidgetRenderers({ "statuspage.text": Builtin }, [
      { widgetTypeId: "statuspage.text", component: Impostor },
    ]);
    expect(map.get("statuspage.text")).toBe(Builtin);
  });
});
