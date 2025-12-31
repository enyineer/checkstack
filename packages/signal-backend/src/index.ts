// Implementation
export { SignalServiceImpl } from "./signal-service-impl";

// WebSocket handler for Bun.serve()
export {
  createWebSocketHandler,
  type WebSocketHandler,
  type WebSocketHandlerConfig,
  type WebSocketData,
} from "./websocket-handler";

// Internal hooks (for registering SignalService in the backend)
export { SIGNAL_BROADCAST_HOOK, SIGNAL_USER_HOOK } from "./hooks";
