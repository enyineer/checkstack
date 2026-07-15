import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import { K8sEventListSchema, K8sEventSchema } from "./k8s-event";
import { eventToLogRecord } from "./mapper";
import { isWithinWindow } from "./window";
import type { K8sEventsConfig } from "./schema";

/**
 * Shared, guard-agnostic pull driver used by BOTH the core backend `execute`
 * (with the platform's SSRF-guarded `ctx.fetch`) and the satellite executor
 * (with a guarded fetch built from `@checkstack/backend-api`). SSRF guarding is
 * the CALLER's responsibility - this module only shapes requests and maps
 * results, so it stays free of any node/backend import and reuses one code path
 * on both sides.
 *
 * VERIFIED Kubernetes API surface (events.k8s.io/v1):
 * - LIST all namespaces: `GET {apiServerUrl}/apis/events.k8s.io/v1/events`
 * - LIST one namespace:  `GET {apiServerUrl}/apis/events.k8s.io/v1/namespaces/{ns}/events`
 * - Auth header:         `Authorization: Bearer <token>`
 * - Pagination:          `?limit=<n>&continue=<token>`; the next token is
 *                        `metadata.continue` in the response (absent = last page).
 * - Filters:             `?fieldSelector=...&labelSelector=...`
 *
 * TRANSPORT vs RESULT (healthcheck-collectors rule): a non-2xx response, a
 * non-JSON body, or a body that is not a valid list envelope THROWS (the run is
 * a transport failure). A completed 2xx list with zero events is a SUCCESS. A
 * single item that fails the Event schema is SKIPPED and counted, never fatal.
 *
 * BUDGET vs WINDOW: the Kubernetes list API returns events roughly in
 * resourceVersion (oldest-first) order with NO server-side time filter, so the
 * newest (in-window) events sit on the LAST pages. Two independent budgets keep
 * a pull bounded without starving on the backlog:
 * - `maxEventsPerPull` caps the number of EMITTED (in-window) records. Paging
 *   stops as soon as that many in-window records are collected. It does NOT cap
 *   scanned items - an older version capped scanned items and, on a cluster with
 *   more total events than the cap, spent the whole budget on out-of-window
 *   backlog and emitted ZERO recent events every run.
 * - `K8S_EVENTS_MAX_PAGES` hard-bounds the SCAN so a busy cluster (or a broken
 *   server) can never spin unboundedly. If the budget is hit while a `continue`
 *   token is still pending: a scan that saw at least one item is a BUSY cluster
 *   - stop and return what was collected with `truncated: true`; a scan that saw
 *   ZERO items across every page yet kept getting `continue` tokens is a
 *   misbehaving server - THROW a transport error.
 */

/** Per-page item cap for the Kubernetes `limit` query parameter. */
export const K8S_EVENTS_PAGE_LIMIT = 500;

/**
 * Hard cap on pages SCANNED per pull: `K8S_EVENTS_MAX_PAGES` x
 * `K8S_EVENTS_PAGE_LIMIT` items (40 x 500 = 20k). Bounds the oldest-first scan
 * so a large backlog or a misbehaving `continue` loop cannot page forever;
 * unlike `maxEventsPerPull` this counts scanned items, not emitted records.
 */
export const K8S_EVENTS_MAX_PAGES = 40;

export interface K8sEventsPullResult {
  /** Records inside the current window, ready for the sink. */
  records: NormalizedLogRecord[];
  /** Total events fetched across all pages this run. */
  fetched: number;
  /** Events skipped (schema-invalid or no usable timestamp). */
  skipped: number;
  /**
   * True when the page-scan budget was exhausted while the server still had
   * more pages (a busy cluster): the returned records are a partial view of the
   * window. Callers should warn and suggest narrowing the stream (namespace /
   * fieldSelector). False on a normal complete scan.
   */
  truncated: boolean;
}

/** Build the events LIST URL for the configured (or all-) namespace. */
export function buildEventsListUrl({
  apiServerUrl,
  namespace,
}: {
  apiServerUrl: string;
  namespace?: string;
}): string {
  const base = apiServerUrl.replace(/\/+$/, "");
  const ns = namespace?.trim();
  return ns
    ? `${base}/apis/events.k8s.io/v1/namespaces/${encodeURIComponent(ns)}/events`
    : `${base}/apis/events.k8s.io/v1/events`;
}

/** Append the page/query parameters to the list URL. */
function pageUrl({
  listUrl,
  limit,
  cont,
  fieldSelector,
  labelSelector,
}: {
  listUrl: string;
  limit: number;
  cont: string | undefined;
  fieldSelector: string | undefined;
  labelSelector: string | undefined;
}): string {
  const url = new URL(listUrl);
  url.searchParams.set("limit", String(limit));
  if (cont) url.searchParams.set("continue", cont);
  if (fieldSelector) url.searchParams.set("fieldSelector", fieldSelector);
  if (labelSelector) url.searchParams.set("labelSelector", labelSelector);
  return url.toString();
}

/**
 * List Kubernetes events, paging with `limit`/`continue`, and return the records
 * whose effective timestamp falls in the current window. Paging stops once
 * `maxEventsPerPull` IN-WINDOW records are collected (the emitted cap) or the
 * `K8S_EVENTS_MAX_PAGES` scan budget is exhausted, whichever comes first.
 * `fetchImpl` MUST already apply the SSRF egress guard.
 */
export async function runK8sEventsPull({
  config,
  fetchImpl,
  now = () => new Date(),
  abortSignal,
}: {
  config: K8sEventsConfig;
  fetchImpl: typeof fetch;
  now?: () => Date;
  abortSignal?: AbortSignal;
}): Promise<K8sEventsPullResult> {
  const at = now();
  const listUrl = buildEventsListUrl({
    apiServerUrl: config.apiServerUrl,
    namespace: config.namespace,
  });

  const records: NormalizedLogRecord[] = [];
  let fetched = 0;
  let skipped = 0;
  let cont: string | undefined;
  let pages = 0;
  let truncated = false;

  // Cap is on EMITTED (in-window) records, not scanned items: the newest events
  // sit on the last pages, so we must be free to page past an out-of-window
  // backlog. The scan itself is bounded by K8S_EVENTS_MAX_PAGES below.
  while (records.length < config.maxEventsPerPull) {
    if (pages >= K8S_EVENTS_MAX_PAGES) {
      // Budget exhausted with a continue token still pending (we only reach here
      // when the previous page returned one). A scan that saw items is a busy
      // cluster - stop and report truncation; a scan that saw ZERO items across
      // every page yet kept paging is a misbehaving server - fail as transport.
      if (fetched > 0) {
        truncated = true;
        break;
      }
      throw new Error(
        `kubernetes events list exceeded the page budget (${K8S_EVENTS_MAX_PAGES} pages) without completing - server paging is misbehaving`,
      );
    }
    pages += 1;
    const url = pageUrl({
      listUrl,
      limit: K8S_EVENTS_PAGE_LIMIT,
      cont,
      fieldSelector: config.fieldSelector,
      labelSelector: config.labelSelector,
    });

    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${config.bearerToken}`,
        accept: "application/json",
      },
      ...(abortSignal ? { signal: abortSignal } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `kubernetes events list failed: HTTP ${response.status} ${response.statusText}`,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new Error(
        `kubernetes events list returned non-JSON body: ${String(error)}`,
      );
    }

    const list = K8sEventListSchema.safeParse(json);
    if (!list.success) {
      throw new Error(
        `kubernetes events list envelope invalid: ${list.error.message}`,
      );
    }

    for (const item of list.data.items) {
      fetched++;
      const parsed = K8sEventSchema.safeParse(item);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      const record = eventToLogRecord(parsed.data);
      if (!record) {
        skipped++;
        continue;
      }
      if (
        isWithinWindow({
          ts: record.ts,
          now: at,
          lookbackSeconds: config.lookbackSeconds,
        })
      ) {
        records.push(record);
        if (records.length >= config.maxEventsPerPull) break;
      }
    }

    cont = list.data.metadata?.continue;
    if (!cont) break; // last page
  }

  return { records, fetched, skipped, truncated };
}
