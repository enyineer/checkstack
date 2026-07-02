import { describe, it, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider, Position, type NodeProps } from "@xyflow/react";
import {
  SystemNodeComponent,
  type SystemNode,
  type SystemNodeData,
} from "./SystemNode";

/**
 * Regression guard for the dependency-map "invisible edges" bug: React Flow
 * silently drops every edge whose source node has no source handle, so a node
 * must render its source handle even for users WITHOUT manage access on the
 * system - only connectability (drag-to-connect) is gated on `canManage`.
 * Rendered via react-dom/server: no DOM is needed to assert the markup
 * structure, and ReactFlowProvider supplies the store context Handle requires.
 */

const buildNodeProps = ({
  canManage,
}: {
  canManage: boolean;
}): NodeProps<SystemNode> => {
  const data: SystemNodeData = {
    label: "Checkout",
    systemId: "sys-1",
    status: "operational",
    upstreamCount: 1,
    downstreamCount: 1,
    canManage,
  };

  return {
    id: "sys-1",
    type: "system",
    data,
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  };
};

const renderNode = ({ canManage }: { canManage: boolean }): string =>
  renderToStaticMarkup(
    <ReactFlowProvider>
      <SystemNodeComponent {...buildNodeProps({ canManage })} />
    </ReactFlowProvider>,
  );

/** Extract the source handle element's opening tag from the markup. */
const sourceHandleTag = (html: string): string | undefined => {
  const match = html.match(/<div[^>]*class="[^"]*\bsource\b[^"]*"[^>]*>/);
  return match?.[0];
};

describe("SystemNodeComponent handles", () => {
  it("renders the source handle even when the user cannot manage the system", () => {
    const html = renderNode({ canManage: false });

    const handle = sourceHandleTag(html);
    expect(handle).toBeDefined();
    expect(handle).toContain("react-flow__handle-right");

    // Read-only: the handle is inert (no connection-start affordance) and
    // muted, with the explanatory tooltip.
    expect(handle).not.toContain("connectablestart");
    expect(handle).toContain("!bg-muted-foreground/25");
    expect(handle).toContain(
      "You can only add dependencies from systems you manage",
    );
  });

  it("renders a connectable violet source handle when the user manages the system", () => {
    const html = renderNode({ canManage: true });

    const handle = sourceHandleTag(html);
    expect(handle).toBeDefined();
    expect(handle).toContain("react-flow__handle-right");
    expect(handle).toContain("connectablestart");
    expect(handle).toContain("!bg-violet-400/60");
    expect(handle).not.toContain(
      "You can only add dependencies from systems you manage",
    );
  });

  it("always renders the target handle (targets are not access-checked)", () => {
    for (const canManage of [false, true]) {
      const html = renderNode({ canManage });
      expect(html).toContain("react-flow__handle-left");
      expect(html).toMatch(/<div[^>]*class="[^"]*\btarget\b[^"]*"[^>]*>/);
    }
  });
});
