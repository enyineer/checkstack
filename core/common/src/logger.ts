/**
 * Backend logger interface used everywhere in the platform via `RpcContext.logger`
 * and the various `coreServices.logger` accessors.
 *
 * Each method accepts a free-form trailing argument list (`...args: unknown[]`)
 * so the long-standing varargs callsites - `logger.error("…", err)` where `err`
 * is an `Error`, or `logger.info("…", value1, value2)` - keep working unchanged.
 *
 * For NEW code, prefer the structured-metadata shape:
 *
 *   logger.info("did something", { userId, durationMs });
 *
 * Winston's `splat` handling treats a single trailing plain object as
 * structured metadata (merged into the log entry), and an `Error` instance as
 * a special-cased error (with stack). Either shape lands in the same vararg
 * slot here, so this signature covers both without overload churn.
 *
 * Auto-injected metadata (when the request flows through
 * `correlationMiddleware`): `{ correlationId, pluginId, userId? }`. Do NOT
 * include secrets in the structured-metadata object - it is forwarded
 * verbatim to the log destination.
 *
 * Lives in `@checkstack/common` (rather than `@checkstack/backend-api`) so that
 * low-level packages such as `@checkstack/cache-api` and `@checkstack/queue-api`
 * can reference it without taking a dependency on `backend-api` - which would
 * create a publish-time dependency cycle. `@checkstack/backend-api` re-exports
 * it for backward compatibility.
 */
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  /**
   * Returns a derived logger with the supplied metadata bound to every
   * subsequent log entry. Used by `correlationMiddleware` to attach
   * `{ correlationId, pluginId, userId? }`, and available to handlers that
   * want a tighter scope (e.g. `ctx.logger.child({ jobId })`).
   *
   * Optional only to keep minimal test-mock logger objects compatible with
   * this interface - production loggers (Winston via `core/backend`) always
   * implement it. Call sites that rely on metadata binding should branch
   * on presence and fall back to the base logger when it is not available.
   */
  child?(meta: Record<string, unknown>): Logger;
}
