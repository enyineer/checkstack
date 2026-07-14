import { describe, it, expect } from "bun:test";
import {
  initialWebhookPanelState,
  isWebhookPanelOpen,
  webhookPanelReducer,
} from "./webhook-panel.logic";

const info = { path: "/api/telemetry/hooks/abc", secret: "whsec_123" };

describe("webhookPanelReducer", () => {
  it("starts closed", () => {
    expect(isWebhookPanelOpen(initialWebhookPanelState)).toBe(false);
  });

  it("reveals the handed info once", () => {
    const state = webhookPanelReducer(initialWebhookPanelState, {
      type: "reveal",
      info,
    });
    expect(isWebhookPanelOpen(state)).toBe(true);
    expect(state.info).toEqual(info);
  });

  it("drops the secret on dismiss so it can never be re-shown", () => {
    const revealed = webhookPanelReducer(initialWebhookPanelState, {
      type: "reveal",
      info,
    });
    const dismissed = webhookPanelReducer(revealed, { type: "dismiss" });
    expect(dismissed.info).toBeNull();
    expect(isWebhookPanelOpen(dismissed)).toBe(false);
  });
});
