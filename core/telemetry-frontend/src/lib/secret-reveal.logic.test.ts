import { describe, it, expect } from "bun:test";
import type { PushInfo, WebhookInfo } from "@checkstack/telemetry-common";
import {
  initialSecretRevealState,
  isSecretRevealOpen,
  secretRevealReducer,
  type SecretReveal,
} from "./secret-reveal.logic";

const webhook: WebhookInfo = {
  path: "/api/telemetry/hooks/abc",
  secret: "whsec_123",
};
const push: PushInfo = {
  token: "ckms_abc",
  endpoints: [{ kind: "otlp", path: "/api/metricstream/v1/metrics", label: "OTLP" }],
};

describe("secretRevealReducer", () => {
  it("starts closed", () => {
    expect(isSecretRevealOpen(initialSecretRevealState)).toBe(false);
  });

  it("reveals a webhook result once", () => {
    const reveal: SecretReveal = { kind: "webhook", info: webhook };
    const state = secretRevealReducer(initialSecretRevealState, {
      type: "reveal",
      reveal,
    });
    expect(isSecretRevealOpen(state)).toBe(true);
    expect(state.reveal).toEqual(reveal);
  });

  it("reveals a push result once", () => {
    const reveal: SecretReveal = { kind: "push", info: push };
    const state = secretRevealReducer(initialSecretRevealState, {
      type: "reveal",
      reveal,
    });
    expect(isSecretRevealOpen(state)).toBe(true);
    expect(state.reveal).toEqual(reveal);
  });

  it("drops the secret on dismiss so it can never be re-shown", () => {
    const revealed = secretRevealReducer(initialSecretRevealState, {
      type: "reveal",
      reveal: { kind: "push", info: push },
    });
    const dismissed = secretRevealReducer(revealed, { type: "dismiss" });
    expect(dismissed.reveal).toBeNull();
    expect(isSecretRevealOpen(dismissed)).toBe(false);
  });
});
