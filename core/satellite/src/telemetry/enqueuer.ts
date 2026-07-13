/**
 * The minimal telemetry-client surface every agent receiver / scraper depends
 * on. Kept as a tiny shared interface so receivers can be unit-tested with a
 * capturing stub, and so the concrete {@link TelemetryClient} (which implements
 * it) is the only real wiring in the composition root.
 */
export interface TelemetryEnqueuer {
  enqueue(input: {
    kind: string;
    items: unknown[];
    estimateBytes: (item: unknown) => number;
    /**
     * Derives the loss-attribution group key for an item (e.g. its stream token
     * or scrape target id) so a buffer drop is charged to the right stream.
     */
    groupKeyOf: (item: unknown) => string;
  }): void;
}
