import { describe, expect, it, mock, type Mock } from "bun:test";
import { call, implement } from "@orpc/server";
import { z } from "zod";
import { proc } from "@checkstack/common";
import {
  autoAuthMiddleware,
  CORRELATION_ID_HEADER,
  correlationMiddleware,
  RpcContext,
} from "./rpc";
import { createMockRpcContext } from "./test-utils";
import { Logger } from "./types";

const echoLoggerProcedure = proc({
  userType: "anonymous",
  operationType: "query",
  access: [],
}).output(
  z.object({
    correlationIdFromMeta: z.string().optional(),
    pluginIdFromMeta: z.string().optional(),
    userIdFromMeta: z.string().optional(),
  }),
);

const testContract = {
  echo: echoLoggerProcedure,
};

type LastChildMeta = Record<string, unknown> | undefined;

function buildRouterCapturingChildMeta(captureRef: { value: LastChildMeta }) {
  const os = implement(testContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    echo: os.echo.handler(({ context }) => {
      // The capture happens in the child() mock on the test's logger.
      // We just return the metadata that the middleware should have bound.
      void context.logger;
      return {
        correlationIdFromMeta: captureRef.value?.correlationId as
          | string
          | undefined,
        pluginIdFromMeta: captureRef.value?.pluginId as string | undefined,
        userIdFromMeta: captureRef.value?.userId as string | undefined,
      };
    }),
  });
}

function buildContextWithCapture(
  overrides: Partial<RpcContext> = {},
): {
  context: RpcContext;
  capture: { value: LastChildMeta };
  childMock: Mock<(meta: Record<string, unknown>) => Logger>;
} {
  const capture: { value: LastChildMeta } = { value: undefined };
  const childMock = mock((meta: Record<string, unknown>): Logger => {
    capture.value = meta;
    return {
      info: mock(),
      error: mock(),
      warn: mock(),
      debug: mock(),
    };
  });
  const baseContext = createMockRpcContext(overrides);
  // Replace the logger so child() captures the bound metadata.
  baseContext.logger = {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    child: childMock,
  };
  return { context: baseContext, capture, childMock };
}

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("correlationMiddleware", () => {
  it("generates a UUID v4 when no x-correlation-id header is present", async () => {
    const { context, capture } = buildContextWithCapture();
    const router = buildRouterCapturingChildMeta(capture);

    await call(router.echo, {}, { context });

    expect(typeof capture.value?.correlationId).toBe("string");
    expect(capture.value?.correlationId).toMatch(UUID_V4_REGEX);
  });

  it("uses the incoming x-correlation-id header when present", async () => {
    const incoming = "11111111-2222-4333-8444-555555555555";
    const { context, capture } = buildContextWithCapture({
      requestHeaders: new Headers({ [CORRELATION_ID_HEADER]: incoming }),
    });
    const router = buildRouterCapturingChildMeta(capture);

    await call(router.echo, {}, { context });

    expect(capture.value?.correlationId).toBe(incoming);
  });

  it("ignores an empty x-correlation-id header and generates a fresh ID", async () => {
    const { context, capture } = buildContextWithCapture({
      requestHeaders: new Headers({ [CORRELATION_ID_HEADER]: "" }),
    });
    const router = buildRouterCapturingChildMeta(capture);

    await call(router.echo, {}, { context });

    expect(capture.value?.correlationId).toMatch(UUID_V4_REGEX);
  });

  it("echoes the correlation ID on responseHeaders when available", async () => {
    const responseHeaders = new Headers();
    const { context, capture } = buildContextWithCapture({
      responseHeaders,
    });
    const router = buildRouterCapturingChildMeta(capture);

    await call(router.echo, {}, { context });

    const echoed = responseHeaders.get(CORRELATION_ID_HEADER);
    expect(echoed).not.toBeNull();
    expect(echoed).toBe(capture.value?.correlationId as string);
  });

  it("binds pluginId from context.pluginMetadata onto the child logger", async () => {
    const { context, capture } = buildContextWithCapture({
      pluginMetadata: { pluginId: "fancy-plugin" },
    });
    const router = buildRouterCapturingChildMeta(capture);

    await call(router.echo, {}, { context });

    expect(capture.value?.pluginId).toBe("fancy-plugin");
  });

  it("binds userId when the user has an id field", async () => {
    const { context, capture } = buildContextWithCapture({
      user: { type: "user", id: "user-abc", accessRules: ["*"] },
    });
    const router = buildRouterCapturingChildMeta(capture);

    await call(router.echo, {}, { context });

    expect(capture.value?.userId).toBe("user-abc");
  });

  it("omits userId when the user is a service (no id field)", async () => {
    const { context, capture } = buildContextWithCapture({
      user: { type: "service", pluginId: "internal-svc" },
    });
    const router = buildRouterCapturingChildMeta(capture);

    await call(router.echo, {}, { context });

    expect("userId" in (capture.value ?? {})).toBe(false);
  });

  it("falls back to the base logger when child() is not implemented", async () => {
    // Reproduce a minimal mock logger without `.child` (e.g. a test mock
    // that hasn't been updated). The middleware must not throw and the
    // request must still complete.
    const context = createMockRpcContext();
    context.logger = {
      info: mock(),
      error: mock(),
      warn: mock(),
      debug: mock(),
      // intentionally no child
    };

    const os = implement(testContract)
      .$context<RpcContext>()
      .use(correlationMiddleware)
      .use(autoAuthMiddleware);
    const router = os.router({
      echo: os.echo.handler(() => ({})),
    });

    const result = await call(router.echo, {}, { context });
    expect(result).toEqual({});
  });
});
