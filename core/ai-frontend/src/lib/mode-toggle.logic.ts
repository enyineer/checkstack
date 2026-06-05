import {
  AiPermissionModeSchema,
  DEFAULT_PERMISSION_MODE,
  type AiPermissionMode,
} from "@checkstack/ai-common";

/**
 * Pure, DOM-free helpers for the Approve/Auto permission-mode toggle in the chat
 * header (Phase 4). The toggle state derives from the loaded conversation's
 * `permissionMode`; persistence goes through `updateConversation`. These helpers
 * encode that derivation + payload shaping so they are unit-testable under
 * `bun test` without rendering the component.
 */

/** The two selectable permission modes, in display order, with labels. */
export const PERMISSION_MODE_OPTIONS: ReadonlyArray<{
  value: AiPermissionMode;
  label: string;
}> = [
  { value: "approve", label: "Approve" },
  { value: "auto", label: "Auto" },
];

/**
 * Derive the toggle's current value from a loaded conversation's
 * `permissionMode`. Falls back to the safe default (`approve`) when no
 * conversation is loaded or the stored value is missing/unrecognized (defensive
 * against a legacy/corrupt row), so the toggle never renders an invalid state.
 */
export function deriveModeToggleValue({
  conversationMode,
}: {
  conversationMode: string | null | undefined;
}): AiPermissionMode {
  const parsed = AiPermissionModeSchema.safeParse(conversationMode);
  return parsed.success ? parsed.data : DEFAULT_PERMISSION_MODE;
}

/**
 * Shape the `updateConversation` payload for a mode change. Returns `undefined`
 * when there is no conversation to update OR the requested mode already matches
 * the current one (avoid a no-op write). Otherwise returns the owner-scoped
 * update input the mutation consumes.
 */
export function buildModeUpdate({
  conversationId,
  currentMode,
  nextMode,
}: {
  conversationId: string | undefined;
  currentMode: AiPermissionMode;
  nextMode: AiPermissionMode;
}): { id: string; permissionMode: AiPermissionMode } | undefined {
  if (!conversationId) return undefined;
  if (currentMode === nextMode) return undefined;
  return { id: conversationId, permissionMode: nextMode };
}
