/**
 * Race a promise against a wall-clock timeout.
 *
 * Used to bound calls into third-party integrations (a provider's dynamic
 * option resolver, which reaches out to Jira / Teams / Webex / ...). An
 * unreachable or hung integration must not stall the caller indefinitely: the
 * automation editor and the AI propose-time validator both await that path, so
 * without a ceiling an offline integration can wedge a whole chat turn.
 *
 * Note this races, it does not cancel — the underlying work may still run to
 * completion in the background. Providers SHOULD additionally bound their own
 * HTTP calls (e.g. via `AbortSignal.timeout`) so the abandoned work also stops;
 * this is the provider-agnostic backstop on top of that.
 */
export async function withTimeout<T>({
  promise,
  timeoutMs,
  onTimeout,
}: {
  promise: Promise<T>;
  timeoutMs: number;
  onTimeout: () => Error;
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    // Always clear the timer so a fast-resolving promise never leaves a pending
    // timeout keeping the event loop alive.
    if (timer) clearTimeout(timer);
  }
}
