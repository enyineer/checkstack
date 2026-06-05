/**
 * Live MCP / Streamable-HTTP connection registry.
 *
 * STATE & SCALE (the one allowed pod-local exception, decision 9): this map
 * holds connections physically terminated on THIS pod. It is bookkeeping only,
 * NEVER a queryable source of truth — the same exception class as the satellite
 * WebSocket registry. A connection's authorization is re-derived on every
 * request from the durable OAuth token (introspect + narrow), so nothing about
 * a principal's rights lives here. Declared non-reactive:
 * `declareNonReactiveState({ reason: "bookkeeping" })`.
 */

export interface McpConnection {
  /** Opaque session id (MCP `Mcp-Session-Id`). */
  sessionId: string;
  /** Bound principal id (the OAuth token's user), for diagnostics only. */
  principalId: string;
  /** When this connection was opened on this pod. */
  openedAt: Date;
}

export interface McpConnectionRegistry {
  open(args: { sessionId: string; principalId: string }): McpConnection;
  get(sessionId: string): McpConnection | undefined;
  close(sessionId: string): void;
  /** Count of connections terminated on THIS pod (diagnostics). */
  size(): number;
}

export function createMcpConnectionRegistry(): McpConnectionRegistry {
  // declareNonReactiveState({ reason: "bookkeeping" }) — pod-local only.
  const connections = new Map<string, McpConnection>();

  return {
    open({ sessionId, principalId }) {
      const conn: McpConnection = {
        sessionId,
        principalId,
        openedAt: new Date(),
      };
      connections.set(sessionId, conn);
      return conn;
    },
    get(sessionId) {
      return connections.get(sessionId);
    },
    close(sessionId) {
      connections.delete(sessionId);
    },
    size() {
      return connections.size;
    },
  };
}
