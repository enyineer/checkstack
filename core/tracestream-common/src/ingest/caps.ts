/**
 * Per-span structural caps enforced by EVERY ingest entry point - the OTLP and
 * native parsers cap while decoding, and the satellite wire schema rejects
 * over-cap items so a forwarded span can never be more permissive than the
 * same span pushed directly. One constant each so the paths cannot drift.
 */

export const MAX_ATTRIBUTES_PER_SPAN = 256;
export const MAX_EVENTS_PER_SPAN = 128;
export const MAX_LINKS_PER_SPAN = 128;
