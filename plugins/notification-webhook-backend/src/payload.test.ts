import { describe, it, expect } from "bun:test";
import type { NotificationPayload } from "@checkstack/backend-api";
import {
  buildWebhookPayload,
  webhookPayloadSchema,
  WEBHOOK_PAYLOAD_VERSION,
} from "./payload";

const fixedNow = () => new Date("2026-07-08T10:00:00.000Z");

describe("buildWebhookPayload", () => {
  it("builds a schema-valid envelope with all fields", () => {
    const notification: NotificationPayload = {
      title: "System health critical: Payments API",
      body: 'Health check **"HTTP probe"** is failing.',
      importance: "critical",
      type: "healthcheck.alert",
      action: { label: "View failing checks", url: "https://app/x?filter=failing" },
      subjects: [
        {
          kind: "catalog.system",
          id: "sys-1",
          name: "Payments API",
          url: "https://app/sys-1",
          status: "unhealthy",
        },
        { kind: "healthcheck.healthcheck", id: "cfg-9", name: "HTTP probe" },
      ],
    };

    const payload = buildWebhookPayload({ notification, now: fixedNow });

    expect(() => webhookPayloadSchema.parse(payload)).not.toThrow();
    expect(payload.version).toBe(WEBHOOK_PAYLOAD_VERSION);
    expect(payload.timestamp).toBe("2026-07-08T10:00:00.000Z");
    expect(payload.type).toBe("healthcheck.alert");
    expect(payload.importance).toBe("critical");
    expect(payload.action).toEqual({
      label: "View failing checks",
      url: "https://app/x?filter=failing",
    });
    expect(payload.subjects).toHaveLength(2);
    expect(payload.subjects[1]).toEqual({
      kind: "healthcheck.healthcheck",
      id: "cfg-9",
      name: "HTTP probe",
    });
  });

  it("defaults body to an empty string and omits absent action", () => {
    const notification: NotificationPayload = {
      title: "Test",
      importance: "info",
      type: "test",
    };
    const payload = buildWebhookPayload({ notification, now: fixedNow });
    expect(payload.body).toBe("");
    expect(payload.action).toBeUndefined();
    expect(payload.subjects).toEqual([]);
    expect(() => webhookPayloadSchema.parse(payload)).not.toThrow();
  });
});
