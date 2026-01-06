import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  createWebSocketHandler,
  type WebSocketData,
} from "../src/websocket-handler";
import { SIGNAL_BROADCAST_HOOK, SIGNAL_USER_HOOK } from "../src/hooks";
import type { EventBus, Logger } from "@checkmate-monitor/backend-api";
import type { Server, ServerWebSocket } from "bun";

describe("createWebSocketHandler", () => {
  let mockEventBus: EventBus;
  let mockLogger: Logger;
  let subscriptions: Array<{
    group: string;
    hook: unknown;
    handler: (payload: unknown) => Promise<void>;
    mode: string;
  }>;

  beforeEach(() => {
    subscriptions = [];

    mockEventBus = {
      emit: mock(async () => {}),
      subscribe: mock(async (group, hook, handler, options) => {
        subscriptions.push({ group, hook, handler, mode: options?.mode || "" });
      }),
      shutdown: mock(async () => {}),
    } as unknown as EventBus;

    mockLogger = {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      child: mock(() => mockLogger),
    } as unknown as Logger;
  });

  describe("initialization", () => {
    it("should create handler with websocket configuration", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      expect(handler).toHaveProperty("setServer");
      expect(handler).toHaveProperty("websocket");
      expect(handler.websocket).toHaveProperty("open");
      expect(handler.websocket).toHaveProperty("message");
      expect(handler.websocket).toHaveProperty("close");
    });

    it("should subscribe to EventBus hooks when server is set", async () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const mockServer = {
        publish: mock(() => {}),
      } as unknown as Server<WebSocketData>;

      handler.setServer(mockServer);

      // Wait for async subscription setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscriptions).toHaveLength(2);
      expect(subscriptions[0].hook).toBe(SIGNAL_BROADCAST_HOOK);
      expect(subscriptions[1].hook).toBe(SIGNAL_USER_HOOK);
    });

    it("should subscribe with broadcast mode", async () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const mockServer = {
        publish: mock(() => {}),
      } as unknown as Server<WebSocketData>;

      handler.setServer(mockServer);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscriptions[0].mode).toBe("broadcast");
      expect(subscriptions[1].mode).toBe("broadcast");
    });
  });

  describe("websocket.open", () => {
    it("should subscribe authenticated user to broadcast and user channels", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const subscribedChannels: string[] = [];
      const mockWs = {
        data: { userId: "user-123", createdAt: Date.now() },
        subscribe: mock((channel: string) => subscribedChannels.push(channel)),
        send: mock(() => {}),
      } as unknown as ServerWebSocket<WebSocketData>;

      handler.websocket.open(mockWs);

      expect(subscribedChannels).toContain("signals:broadcast");
      expect(subscribedChannels).toContain("signals:user:user-123");
    });

    it("should subscribe anonymous user to broadcast channel only", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const subscribedChannels: string[] = [];
      const mockWs = {
        data: { userId: undefined, createdAt: Date.now() },
        subscribe: mock((channel: string) => subscribedChannels.push(channel)),
        send: mock(() => {}),
      } as unknown as ServerWebSocket<WebSocketData>;

      handler.websocket.open(mockWs);

      expect(subscribedChannels).toContain("signals:broadcast");
      expect(subscribedChannels).not.toContain("signals:user:undefined");
      expect(subscribedChannels).toHaveLength(1);
    });

    it("should send connected message with userId", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      let sentMessage: string | undefined;
      const mockWs = {
        data: { userId: "user-456", createdAt: Date.now() },
        subscribe: mock(() => {}),
        send: mock((msg: string) => {
          sentMessage = msg;
        }),
      } as unknown as ServerWebSocket<WebSocketData>;

      handler.websocket.open(mockWs);

      expect(sentMessage).toBeDefined();
      const parsed = JSON.parse(sentMessage!);
      expect(parsed.type).toBe("connected");
      expect(parsed.userId).toBe("user-456");
    });

    it("should send 'anonymous' userId for unauthenticated connections", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      let sentMessage: string | undefined;
      const mockWs = {
        data: { userId: undefined, createdAt: Date.now() },
        subscribe: mock(() => {}),
        send: mock((msg: string) => {
          sentMessage = msg;
        }),
      } as unknown as ServerWebSocket<WebSocketData>;

      handler.websocket.open(mockWs);

      const parsed = JSON.parse(sentMessage!);
      expect(parsed.type).toBe("connected");
      expect(parsed.userId).toBe("anonymous");
    });
  });

  describe("websocket.message", () => {
    it("should respond to ping with pong", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      let sentMessage: string | undefined;
      const mockWs = {
        data: { userId: "user-123", createdAt: Date.now() },
        send: mock((msg: string) => {
          sentMessage = msg;
        }),
      } as unknown as ServerWebSocket<WebSocketData>;

      handler.websocket.message(mockWs, JSON.stringify({ type: "ping" }));

      expect(sentMessage).toBeDefined();
      const parsed = JSON.parse(sentMessage!);
      expect(parsed.type).toBe("pong");
    });

    it("should handle invalid JSON gracefully", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const mockWs = {
        data: { userId: "user-123", createdAt: Date.now() },
        send: mock(() => {}),
      } as unknown as ServerWebSocket<WebSocketData>;

      // Should not throw
      expect(() => {
        handler.websocket.message(mockWs, "invalid json {{{");
      }).not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("should ignore unknown message types", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      let sentMessage: string | undefined;
      const mockWs = {
        data: { userId: "user-123", createdAt: Date.now() },
        send: mock((msg: string) => {
          sentMessage = msg;
        }),
      } as unknown as ServerWebSocket<WebSocketData>;

      handler.websocket.message(mockWs, JSON.stringify({ type: "unknown" }));

      // Should not send any response for unknown types
      expect(sentMessage).toBeUndefined();
    });
  });

  describe("websocket.close", () => {
    it("should log close event with user info", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const mockWs = {
        data: { userId: "user-789", createdAt: Date.now() },
      } as unknown as ServerWebSocket<WebSocketData>;

      handler.websocket.close(mockWs, 1000, "Normal closure");

      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("should handle anonymous user close", () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const mockWs = {
        data: { userId: undefined, createdAt: Date.now() },
      } as unknown as ServerWebSocket<WebSocketData>;

      expect(() => {
        handler.websocket.close(mockWs, 1001, "Going away");
      }).not.toThrow();
    });
  });

  describe("signal relay", () => {
    it("should publish broadcast signals to broadcast channel", async () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      let publishedChannel: string | undefined;
      let publishedMessage: string | undefined;
      const mockServer = {
        publish: mock((channel: string, message: string) => {
          publishedChannel = channel;
          publishedMessage = message;
        }),
      } as unknown as Server<WebSocketData>;

      handler.setServer(mockServer);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the broadcast handler and call it
      const broadcastSubscription = subscriptions.find(
        (s) => s.hook === SIGNAL_BROADCAST_HOOK
      );
      expect(broadcastSubscription).toBeDefined();

      await broadcastSubscription!.handler({
        signalId: "test.signal",
        payload: { data: "test" },
        timestamp: new Date().toISOString(),
      });

      expect(publishedChannel).toBe("signals:broadcast");
      expect(publishedMessage).toBeDefined();

      const parsed = JSON.parse(publishedMessage!);
      expect(parsed.type).toBe("signal");
      expect(parsed.signalId).toBe("test.signal");
    });

    it("should publish user signals to user-specific channel", async () => {
      const handler = createWebSocketHandler({
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      let publishedChannel: string | undefined;
      let publishedMessage: string | undefined;
      const mockServer = {
        publish: mock((channel: string, message: string) => {
          publishedChannel = channel;
          publishedMessage = message;
        }),
      } as unknown as Server<WebSocketData>;

      handler.setServer(mockServer);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the user handler and call it
      const userSubscription = subscriptions.find(
        (s) => s.hook === SIGNAL_USER_HOOK
      );
      expect(userSubscription).toBeDefined();

      await userSubscription!.handler({
        userId: "target-user",
        message: {
          signalId: "notification.received",
          payload: { id: "n-1" },
          timestamp: new Date().toISOString(),
        },
      });

      expect(publishedChannel).toBe("signals:user:target-user");
      expect(publishedMessage).toBeDefined();

      const parsed = JSON.parse(publishedMessage!);
      expect(parsed.type).toBe("signal");
      expect(parsed.signalId).toBe("notification.received");
    });
  });
});
