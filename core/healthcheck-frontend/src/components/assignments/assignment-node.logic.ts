/**
 * Node-id scheme for the check editor's Assignment section (DOM-free).
 *
 * The editor tree hosts one node group per ASSIGNED SYSTEM, so node ids are
 * namespaced by systemId:
 *
 *   assignment-picker                                → "Assign to system..." panel
 *   assignment:<systemId>:<panel>                    → a built-in per-system panel
 *   assignment:<systemId>:ext:<extensionNodeId>      → an extension-contributed node
 *
 * The `ext` namespace exists because extensions (e.g. the anomaly plugin)
 * build their node ids from the CONFIGURATION id (`anomaly:<configId>`) — in
 * a check-centric tree that id is identical under every system, so the tree
 * wraps the extension slot's `selectedNode`/`onSelectNode` with these
 * builders to keep selections per-system. `extensionNodeId` may itself
 * contain colons, so parsing treats everything after `ext:` as opaque.
 * System ids are UUIDs and never contain colons.
 */

export const ASSIGNMENT_PICKER_NODE = "assignment-picker";
const ASSIGNMENT_PREFIX = "assignment";

export const ASSIGNMENT_PANELS = [
  "general",
  "thresholds",
  "retention",
  "execution",
  "notifications",
] as const;

export type AssignmentPanelKind = (typeof ASSIGNMENT_PANELS)[number];

const isAssignmentPanelKind = (value: string): value is AssignmentPanelKind =>
  (ASSIGNMENT_PANELS as readonly string[]).includes(value);

export type ParsedAssignmentNode =
  | { kind: "picker" }
  | { kind: "panel"; systemId: string; panel: AssignmentPanelKind }
  | { kind: "extension"; systemId: string; extensionNodeId: string };

export function buildAssignmentNodeId({
  systemId,
  panel,
}: {
  systemId: string;
  panel: AssignmentPanelKind;
}): string {
  return `${ASSIGNMENT_PREFIX}:${systemId}:${panel}`;
}

export function buildAssignmentExtensionNodeId({
  systemId,
  extensionNodeId,
}: {
  systemId: string;
  extensionNodeId: string;
}): string {
  return `${ASSIGNMENT_PREFIX}:${systemId}:ext:${extensionNodeId}`;
}

/**
 * Parse an editor tree node id into its assignment meaning, or `undefined`
 * when the id does not belong to the Assignment section (a config-plane node
 * like `general` / `collector:<id>` / `access`).
 */
export function parseAssignmentNodeId(
  nodeId: string,
): ParsedAssignmentNode | undefined {
  if (nodeId === ASSIGNMENT_PICKER_NODE) return { kind: "picker" };

  const [prefix, systemId, third, ...rest] = nodeId.split(":");
  if (prefix !== ASSIGNMENT_PREFIX || !systemId || !third) return;

  if (third === "ext") {
    const extensionNodeId = rest.join(":");
    if (!extensionNodeId) return;
    return { kind: "extension", systemId, extensionNodeId };
  }

  // A built-in panel id has no further segments.
  if (rest.length > 0 || !isAssignmentPanelKind(third)) return;
  return { kind: "panel", systemId, panel: third };
}

/** Does this node id belong to the Assignment section? */
export function isAssignmentNode(nodeId: string): boolean {
  return parseAssignmentNodeId(nodeId) !== undefined;
}

/**
 * The extension-slot adapter's `selectedNode` for one system: unwraps
 * `assignment:<systemId>:ext:<extensionNodeId>` back to the extension's OWN
 * node id when the selection belongs to this system, else `undefined` (the
 * extension sees "not selected").
 */
export function extensionSelectedNodeForSystem({
  selectedNode,
  systemId,
}: {
  selectedNode: string | undefined;
  systemId: string;
}): string | undefined {
  if (!selectedNode) return;
  const parsed = parseAssignmentNodeId(selectedNode);
  if (parsed?.kind !== "extension" || parsed.systemId !== systemId) return;
  return parsed.extensionNodeId;
}
