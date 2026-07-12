import { describe, expect, test } from "bun:test";
import {
  ASSIGNMENT_PICKER_NODE,
  buildAssignmentExtensionNodeId,
  buildAssignmentNodeId,
  extensionSelectedNodeForSystem,
  isAssignmentNode,
  parseAssignmentNodeId,
} from "./assignment-node.logic";

const SYSTEM_ID = "0f1e2d3c-4b5a-4697-8899-aabbccddeeff";

describe("assignment node ids", () => {
  test("panel ids round-trip through build/parse", () => {
    const nodeId = buildAssignmentNodeId({
      systemId: SYSTEM_ID,
      panel: "thresholds",
    });
    expect(parseAssignmentNodeId(nodeId)).toEqual({
      kind: "panel",
      systemId: SYSTEM_ID,
      panel: "thresholds",
    });
  });

  test("extension ids round-trip, including colon-bearing extension node ids", () => {
    // The anomaly plugin builds ids like `anomaly:<configId>` — the extension
    // id itself contains a colon and must survive the wrap/unwrap untouched.
    const extensionNodeId = "anomaly:cfg-1";
    const nodeId = buildAssignmentExtensionNodeId({
      systemId: SYSTEM_ID,
      extensionNodeId,
    });
    expect(parseAssignmentNodeId(nodeId)).toEqual({
      kind: "extension",
      systemId: SYSTEM_ID,
      extensionNodeId,
    });
  });

  test("the picker sentinel parses", () => {
    expect(parseAssignmentNodeId(ASSIGNMENT_PICKER_NODE)).toEqual({
      kind: "picker",
    });
  });

  test("config-plane editor nodes are NOT assignment nodes", () => {
    for (const nodeId of [
      "general",
      "access",
      "systems",
      "collector-picker",
      "collector:abc",
      `anomaly-template:cfg-1`,
    ]) {
      expect(isAssignmentNode(nodeId)).toBe(false);
    }
  });

  test("malformed assignment ids parse to undefined", () => {
    expect(parseAssignmentNodeId("assignment:")).toBeUndefined();
    expect(parseAssignmentNodeId(`assignment:${SYSTEM_ID}`)).toBeUndefined();
    expect(
      parseAssignmentNodeId(`assignment:${SYSTEM_ID}:unknown-panel`),
    ).toBeUndefined();
    expect(
      parseAssignmentNodeId(`assignment:${SYSTEM_ID}:ext:`),
    ).toBeUndefined();
    // A panel id with trailing segments is not a panel.
    expect(
      parseAssignmentNodeId(`assignment:${SYSTEM_ID}:general:extra`),
    ).toBeUndefined();
  });
});

describe("extensionSelectedNodeForSystem", () => {
  const extensionNodeId = "anomaly:cfg-1";
  const wrapped = buildAssignmentExtensionNodeId({
    systemId: SYSTEM_ID,
    extensionNodeId,
  });

  test("unwraps the extension's own id for the matching system", () => {
    expect(
      extensionSelectedNodeForSystem({ selectedNode: wrapped, systemId: SYSTEM_ID }),
    ).toBe(extensionNodeId);
  });

  test("another system's selection reads as not-selected", () => {
    expect(
      extensionSelectedNodeForSystem({
        selectedNode: wrapped,
        systemId: "other-system",
      }),
    ).toBeUndefined();
  });

  test("built-in panels and config-plane nodes read as not-selected", () => {
    expect(
      extensionSelectedNodeForSystem({
        selectedNode: buildAssignmentNodeId({
          systemId: SYSTEM_ID,
          panel: "general",
        }),
        systemId: SYSTEM_ID,
      }),
    ).toBeUndefined();
    expect(
      extensionSelectedNodeForSystem({
        selectedNode: "general",
        systemId: SYSTEM_ID,
      }),
    ).toBeUndefined();
    expect(
      extensionSelectedNodeForSystem({
        selectedNode: undefined,
        systemId: SYSTEM_ID,
      }),
    ).toBeUndefined();
  });
});
