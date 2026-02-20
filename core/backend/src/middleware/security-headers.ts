import type { MiddlewareHandler } from "hono";

const handler: MiddlewareHandler = async (c, next) => {
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
};

export const securityHeaders = (): MiddlewareHandler => handler;
