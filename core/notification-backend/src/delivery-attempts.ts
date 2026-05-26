import { extractErrorMessage } from "@checkstack/common";
import type {
  Logger,
  NotificationSendContext,
  SafeDatabase,
} from "@checkstack/backend-api";
import * as schema from "./schema";

/**
 * Shape of the per-attempt row persisted to
 * `notification_delivery_attempts`. Kept structural (not the Drizzle
 * select type) so callers and tests don't have to know about the
 * underlying ORM type.
 */
export interface DeliveryAttemptRow {
  notificationId: string;
  strategyQualifiedId: string;
  status: "success" | "failure";
  errorMessage: string | null;
  durationMs: number;
}

/**
 * Best-effort: persist a single delivery-attempt row. If the insert
 * itself errors (e.g. transient DB blip), we log and continue so we
 * don't replace one silent dispatch failure with a new one. Wrapping
 * caller MUST NOT rely on the attempt row existing on the happy
 * path - visibility, not correctness.
 *
 * Exported so the dispatch loop in `router.ts` can compose it with the
 * `strategy.send` call, and so unit tests can exercise the best-effort
 * guarantee directly.
 */
export const recordDeliveryAttempt = async ({
  database,
  logger,
  row,
}: {
  database: SafeDatabase<typeof schema>;
  logger: Logger;
  row: DeliveryAttemptRow;
}): Promise<void> => {
  try {
    await database.insert(schema.notificationDeliveryAttempts).values(row);
  } catch (insertError) {
    logger.error(
      `[external-delivery] Failed to persist delivery attempt for ${row.strategyQualifiedId} (notification ${row.notificationId}):`,
      insertError,
    );
  }
};

/**
 * Minimal subset of `NotificationStrategy` the dispatch loop uses when
 * invoking `.send(...)`. Kept structural so `dispatchWithAttempt` can
 * be unit-tested with a fake strategy and so the type doesn't drag in
 * the full `NotificationStrategy<...>` shape (config schemas,
 * contactResolution, etc.) that's irrelevant to attempt persistence.
 */
export interface SendableStrategy {
  qualifiedId: string;
  send: (
    context: NotificationSendContext<unknown, unknown, unknown>,
  ) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Invoke `strategy.send(...)` with duration measurement + best-effort
 * attempt persistence on both branches. Centralised so the same
 * "wrap with timing + persist + don't propagate" contract holds for
 * every external delivery path.
 *
 * `strategy.send` may either:
 *   - resolve with `{ success: true }` -> persisted as a `"success"` row.
 *   - resolve with `{ success: false, error }` -> persisted as a
 *     `"failure"` row using the strategy's own (already-sanitised)
 *     error string.
 *   - throw -> persisted as a `"failure"` row using
 *     `extractErrorMessage(error)` so secrets embedded in raw error
 *     objects (webhook URLs, tokens) are not stored verbatim.
 *
 * Never throws to the caller - the dispatch loop treats this as a
 * fire-and-forget step.
 */
export const dispatchWithAttempt = async ({
  database,
  logger,
  strategy,
  sendContext,
  notificationId,
}: {
  database: SafeDatabase<typeof schema>;
  logger: Logger;
  strategy: SendableStrategy;
  sendContext: NotificationSendContext<unknown, unknown, unknown>;
  notificationId: string;
}): Promise<void> => {
  const startMs = performance.now();
  try {
    const result = await strategy.send(sendContext);
    const durationMs = Math.round(performance.now() - startMs);
    logger.debug(
      `[external-delivery] Send result for ${strategy.qualifiedId}:`,
      result,
    );
    await recordDeliveryAttempt({
      database,
      logger,
      row: result.success
        ? {
            notificationId,
            strategyQualifiedId: strategy.qualifiedId,
            status: "success",
            errorMessage: null,
            durationMs,
          }
        : {
            notificationId,
            strategyQualifiedId: strategy.qualifiedId,
            status: "failure",
            errorMessage: result.error ?? "Strategy reported failure",
            durationMs,
          },
    });
  } catch (sendError) {
    const durationMs = Math.round(performance.now() - startMs);
    logger.error(
      `[external-delivery] Error sending via ${strategy.qualifiedId}:`,
      sendError,
    );
    await recordDeliveryAttempt({
      database,
      logger,
      row: {
        notificationId,
        strategyQualifiedId: strategy.qualifiedId,
        status: "failure",
        // `extractErrorMessage` sanitises arbitrary thrown values -
        // never persist the raw error object since it may embed
        // webhook URLs / tokens via the strategy's send context.
        errorMessage: extractErrorMessage(sendError),
        durationMs,
      },
    });
  }
};
