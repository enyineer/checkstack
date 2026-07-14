import type { WebhookInfo } from "@checkstack/telemetry-common";

/**
 * State for the one-shot panel that reveals a webhook endpoint secret (returned
 * exactly once on create or rotate). Modeled as a pure reducer so the
 * shown-once semantics - reveal the handed info, then drop it on dismiss so it
 * can never be re-shown - are unit-testable without a DOM.
 */
export interface WebhookPanelState {
  info: WebhookInfo | null;
}

export const initialWebhookPanelState: WebhookPanelState = { info: null };

export type WebhookPanelAction =
  | { type: "reveal"; info: WebhookInfo }
  | { type: "dismiss" };

export function webhookPanelReducer(
  _state: WebhookPanelState,
  action: WebhookPanelAction,
): WebhookPanelState {
  switch (action.type) {
    case "reveal": {
      return { info: action.info };
    }
    case "dismiss": {
      return { info: null };
    }
  }
}

/** Whether the secret panel is currently revealing an unseen secret. */
export function isWebhookPanelOpen(state: WebhookPanelState): boolean {
  return state.info !== null;
}
