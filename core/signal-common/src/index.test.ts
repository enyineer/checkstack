import { describe, it, expect } from "bun:test";
import { createSignal, type Signal, type SignalMessage } from "../src/index";
import { z } from "zod";
import type { PluginMetadata } from "@checkstack/common";

const testPlugin: PluginMetadata = { pluginId: "notification" };
const otherPlugin: PluginMetadata = { pluginId: "system" };

describe("createSignal", () => {
  it("constructs id as `${pluginId}.${event}` and stores pluginId", () => {
    const schema = z.object({ message: z.string() });
    const signal = createSignal({
      pluginMetadata: testPlugin,
      event: "test",
      payloadSchema: schema,
    });

    expect(signal.id).toBe("notification.test");
    expect(signal.pluginId).toBe("notification");
    expect(signal.payloadSchema).toBe(schema);
  });

  it("creates signals with different payload types and pluginIds", () => {
    const stringSignal = createSignal({
      pluginMetadata: testPlugin,
      event: "string",
      payloadSchema: z.string(),
    });
    const numberSignal = createSignal({
      pluginMetadata: otherPlugin,
      event: "number",
      payloadSchema: z.number(),
    });

    expect(stringSignal.id).toBe("notification.string");
    expect(stringSignal.pluginId).toBe("notification");
    expect(numberSignal.id).toBe("system.number");
    expect(numberSignal.pluginId).toBe("system");
  });

  it("validates payload against schema", () => {
    const signal = createSignal({
      pluginMetadata: testPlugin,
      event: "received",
      payloadSchema: z.object({
        id: z.string(),
        title: z.string(),
        importance: z.enum(["info", "warning", "critical"]),
      }),
    });

    const validResult = signal.payloadSchema.safeParse({
      id: "n-123",
      title: "Test",
      importance: "info" as const,
    });
    expect(validResult.success).toBe(true);

    const invalidResult = signal.payloadSchema.safeParse({
      id: "n-123",
      title: "Test",
    });
    expect(invalidResult.success).toBe(false);
  });

  it("supports multi-segment event names", () => {
    const signal = createSignal({
      pluginMetadata: { pluginId: "healthcheck" },
      event: "system.status_changed",
      payloadSchema: z.object({ systemId: z.string() }),
    });

    expect(signal.id).toBe("healthcheck.system.status_changed");
    expect(signal.pluginId).toBe("healthcheck");
  });
});

describe("Signal type inference", () => {
  it("infers payload type from schema", () => {
    const signal = createSignal({
      pluginMetadata: testPlugin,
      event: "typed",
      payloadSchema: z.object({ count: z.number(), name: z.string() }),
    });

    type Inferred = z.infer<typeof signal.payloadSchema>;
    const payload: Inferred = { count: 42, name: "test" };
    expect(payload.count).toBe(42);
  });
});

describe("SignalMessage envelope", () => {
  it("carries signalId, pluginId, payload, and timestamp", () => {
    const message: SignalMessage<{ text: string }> = {
      signalId: "notification.test",
      pluginId: "notification",
      payload: { text: "Hello" },
      timestamp: new Date().toISOString(),
    };

    expect(message.signalId).toBe("notification.test");
    expect(message.pluginId).toBe("notification");
    expect(message.payload.text).toBe("Hello");
    expect(typeof message.timestamp).toBe("string");
  });
});

describe("Signal ID conventions", () => {
  it("follows dot-notation naming convention", () => {
    const signals: Signal<unknown>[] = [
      createSignal({
        pluginMetadata: { pluginId: "notification" },
        event: "received",
        payloadSchema: z.string(),
      }),
      createSignal({
        pluginMetadata: { pluginId: "notification" },
        event: "read",
        payloadSchema: z.string(),
      }),
      createSignal({
        pluginMetadata: { pluginId: "system" },
        event: "maintenance.scheduled",
        payloadSchema: z.string(),
      }),
    ];

    for (const signal of signals) {
      expect(signal.id).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });
});
