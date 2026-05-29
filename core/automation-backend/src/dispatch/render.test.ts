import { describe, expect, it } from "bun:test";
import {
  createDefaultFilterRegistry,
  type TemplateContext,
} from "@checkstack/template-engine";
import { renderConfig } from "./render";

const filters = createDefaultFilterRegistry();
const context: TemplateContext = {
  trigger: { payload: { title: "Outage" } },
};

describe("renderConfig", () => {
  it("renders {{ }} in ordinary fields", () => {
    const out = renderConfig({
      config: { message: "Incident {{ trigger.payload.title }} fired" },
      jsonSchema: { properties: { message: { type: "string" } } },
      context,
      filters,
    });
    expect(out).toEqual({ message: "Incident Outage fired" });
  });

  it("leaves native-code fields (shell/typescript/javascript) un-rendered", () => {
    const out = renderConfig({
      config: {
        script: 'echo "{{ trigger.payload.title }}"',
        message: "hi {{ trigger.payload.title }}",
      },
      jsonSchema: {
        properties: {
          script: { "x-editor-types": ["shell"] },
          message: { type: "string" },
        },
      },
      context,
      filters,
    });
    // The code field's template markers stay literal; the plain field renders.
    expect(out).toEqual({
      script: 'echo "{{ trigger.payload.title }}"',
      message: "hi Outage",
    });
  });

  it("treats typescript and javascript editor types as code too", () => {
    const out = renderConfig({
      config: { ts: "const x = {{ trigger.payload.title }};" },
      jsonSchema: { properties: { ts: { "x-editor-types": ["typescript"] } } },
      context,
      filters,
    });
    expect(out).toEqual({ ts: "const x = {{ trigger.payload.title }};" });
  });

  it("falls back to plain rendering when no schema is supplied", () => {
    const out = renderConfig({
      config: { a: "{{ trigger.payload.title }}" },
      jsonSchema: undefined,
      context,
      filters,
    });
    expect(out).toEqual({ a: "Outage" });
  });

  it("passes non-object config straight through the renderer", () => {
    const out = renderConfig({
      config: "{{ trigger.payload.title }}",
      jsonSchema: undefined,
      context,
      filters,
    });
    expect(out).toBe("Outage");
  });
});
