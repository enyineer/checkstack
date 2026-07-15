import type { PushInfo, WebhookInfo } from "@checkstack/telemetry-common";

/**
 * State for the one-shot panel that reveals a source's ingest secret - returned
 * exactly once on create or rotate. A source is EITHER webhook-mode (an endpoint
 * path + signing secret) OR push-mode (a bearer token + inbound endpoints), so
 * the reveal is a discriminated union. Modeled as a pure reducer so the
 * shown-once semantics - reveal the handed info, then drop it on dismiss so it
 * can never be re-shown - are unit-testable without a DOM.
 */
export type SecretReveal =
  | { kind: "webhook"; info: WebhookInfo }
  | { kind: "push"; info: PushInfo };

export interface SecretRevealState {
  reveal: SecretReveal | null;
}

export const initialSecretRevealState: SecretRevealState = { reveal: null };

export type SecretRevealAction =
  | { type: "reveal"; reveal: SecretReveal }
  | { type: "dismiss" };

export function secretRevealReducer(
  _state: SecretRevealState,
  action: SecretRevealAction,
): SecretRevealState {
  switch (action.type) {
    case "reveal": {
      return { reveal: action.reveal };
    }
    case "dismiss": {
      return { reveal: null };
    }
  }
}

/** Whether the panel is currently revealing an unseen secret. */
export function isSecretRevealOpen(state: SecretRevealState): boolean {
  return state.reveal !== null;
}
