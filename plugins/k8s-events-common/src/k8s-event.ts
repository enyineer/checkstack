import { z } from "zod";

/**
 * MINIMAL zod schema of the ONLY fields this source reads from a Kubernetes
 * `events.k8s.io/v1` Event and its list envelope. Unknown fields are ignored.
 *
 * VERIFIED against the official Kubernetes API reference (Event v1
 * events.k8s.io). Field names below are the events.k8s.io/v1 names, which DIFFER
 * from the legacy core/v1 Event:
 * - `eventTime` (MicroTime, RFC3339) is the canonical time (core/v1 used
 *   firstTimestamp/lastTimestamp, now surfaced as the `deprecated*` fields).
 * - `series.count` / `series.lastObservedTime` aggregate a repeating event
 *   (core/v1 used the top-level `count` / `lastTimestamp`).
 * - `note` carries the human message (core/v1 used `message`).
 * - `regarding` is the involved object (core/v1 used `involvedObject`).
 * - `reportingController` / `reportingInstance` replace `source`.
 * MicroTime / MetaV1Time values arrive as RFC3339 strings; some deprecated time
 * fields can be null, so every timestamp is `string | null | undefined`.
 */

const timestampSchema = z.string().nullish();

export const K8sObjectReferenceSchema = z.object({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  namespace: z.string().optional(),
  uid: z.string().optional(),
  fieldPath: z.string().optional(),
});
export type K8sObjectReference = z.infer<typeof K8sObjectReferenceSchema>;

export const K8sEventSchema = z.object({
  metadata: z
    .object({
      name: z.string().optional(),
      namespace: z.string().optional(),
      uid: z.string().optional(),
      creationTimestamp: timestampSchema,
    })
    .optional(),
  /** Canonical occurrence time (MicroTime). */
  eventTime: timestampSchema,
  /** Aggregation of a repeating event. */
  series: z
    .object({
      count: z.number().optional(),
      lastObservedTime: timestampSchema,
    })
    .nullish(),
  reason: z.string().optional(),
  note: z.string().optional(),
  /** "Normal" or "Warning". */
  type: z.string().optional(),
  action: z.string().optional(),
  reportingController: z.string().optional(),
  reportingInstance: z.string().optional(),
  regarding: K8sObjectReferenceSchema.optional(),
  related: K8sObjectReferenceSchema.optional(),
  deprecatedFirstTimestamp: timestampSchema,
  deprecatedLastTimestamp: timestampSchema,
  deprecatedCount: z.number().optional(),
});
export type K8sEvent = z.infer<typeof K8sEventSchema>;

/**
 * The list envelope. `items` is left as `unknown[]` so a single malformed item
 * can be parsed (and skipped) individually rather than failing the whole page.
 * `metadata.continue` carries the pagination token (empty/absent = last page).
 */
export const K8sEventListSchema = z.object({
  kind: z.string().optional(),
  apiVersion: z.string().optional(),
  metadata: z
    .object({
      continue: z.string().optional(),
      resourceVersion: z.string().optional(),
    })
    .optional(),
  items: z.array(z.unknown()),
});
export type K8sEventList = z.infer<typeof K8sEventListSchema>;
