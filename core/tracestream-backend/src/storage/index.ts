import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import * as schema from "../schema";
import type { Storage } from "./ports";
import { createStreamStore } from "./postgres/streams";
import { createTokenStore } from "./postgres/tokens";
import { createSpanStore } from "./postgres/spans";
import { createTraceSummaryStore } from "./postgres/summaries";
import { createOpBucketStore } from "./postgres/op-buckets";
import { createServiceOpCatalogStore } from "./postgres/service-ops";
import { createActivityStore } from "./postgres/activity";
import { createImportantEventStore } from "./postgres/important-events";
import { createSystemLinkStore } from "./postgres/system-links";

export * from "./ports";
export * from "./time";
export * from "./hash";
export * from "./decision";

/**
 * Build every storage PORT over one scoped database. This is the ONLY place the
 * Postgres adapters are constructed; jobs, ingest and the API consume the
 * returned ports and never see drizzle (USER DIRECTIVE). `deleteStreamData`
 * composes the per-table sweeps for the stream-delete cascade; `withFlushTransaction`
 * hands a flush write ports bound to one transaction (atomic flush).
 */
export function createStorage({
  db,
}: {
  db: SafeDatabase<typeof schema>;
}): Storage {
  const streams = createStreamStore({ db });
  const tokens = createTokenStore({ db });
  const importantEvents = createImportantEventStore({ db });
  const systemLinks = createSystemLinkStore({ db });
  // The write ports run on a "runner" (the scoped db by default, or a flush
  // transaction). opBuckets additionally needs the scoped db for its rollup's
  // own per-batch transaction.
  const spans = createSpanStore({ runner: db });
  const summaries = createTraceSummaryStore({ runner: db });
  const opBuckets = createOpBucketStore({ runner: db, db });
  const serviceOps = createServiceOpCatalogStore({ runner: db });
  const activity = createActivityStore({ runner: db });

  return {
    streams,
    tokens,
    spans,
    summaries,
    opBuckets,
    serviceOps,
    activity,
    importantEvents,
    systemLinks,
    async deleteStreamData({ streamId }) {
      // Forward-only, idempotent per-table sweeps: a partial failure leaves rows
      // that the next call (or the retention job) removes. No FKs, so order is
      // free; tokens/spans/summaries/buckets/catalog/activity/events/links cleared.
      await tokens.deleteAllForStream({ streamId });
      await spans.deleteAllForStream({ streamId });
      await summaries.deleteAllForStream({ streamId });
      await opBuckets.deleteAllForStream({ streamId });
      await serviceOps.deleteAllForStream({ streamId });
      await activity.deleteAllForStream({ streamId });
      await importantEvents.deleteAllForStream({ streamId });
      await systemLinks.deleteAllForStream({ streamId });
    },
    async withFlushTransaction(fn) {
      // One transaction, one SET LOCAL search_path: the flush writes commit
      // together or not at all. The ports handed to `fn` run on the tx runner,
      // so nothing touches the outer db mid-flush.
      await withScopedTransaction(db, async (tx) => {
        await fn({
          spans: createSpanStore({ runner: tx }),
          summaries: createTraceSummaryStore({ runner: tx }),
          // db is present for the rollup seam but a flush never calls it.
          opBuckets: createOpBucketStore({ runner: tx, db }),
          serviceOps: createServiceOpCatalogStore({ runner: tx }),
          activity: createActivityStore({ runner: tx }),
        });
      });
    },
  };
}
