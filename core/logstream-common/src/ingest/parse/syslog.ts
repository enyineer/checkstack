/**
 * RFC 5424 syslog message parser. Extracts the PRI severity, the timestamp, the
 * structured-data elements, and the free-text MSG, then resolves the stream
 * source token from either a structured-data element
 * (`[checkstack@50501 token="ckls_..."]`) or a `@ckls_...@ ` MSG prefix.
 *
 * Pure module: no IO (the TCP/TLS listener and framing live elsewhere).
 */

import type { NormalizedLogRecord } from "@checkstack/telemetry-common";
import type { IngestedLine, LogStreamConfig } from "../../schemas";
import {
  bandFromSyslogPri,
  syslogSeverityName,
  SEVERITY_NUMBER_FOR_BAND,
  type SeverityBand,
} from "../../severity";
import {
  truncateBody,
  capAttributes,
  clampEventTimestamp,
  applySeverityValueMap,
} from "../normalize";

/** The structured-data SD-ID Checkstack looks for the token in. */
export const CHECKSTACK_SD_ID_PREFIX = "checkstack@";

export interface ParsedSyslog {
  pri: number;
  severityNumber: number;
  band: SeverityBand;
  /** Event time, or null when the source sent the nil timestamp `-`. */
  ts: Date | null;
  hostname?: string;
  appName?: string;
  procId?: string;
  msgId?: string;
  structuredData: Record<string, Record<string, string>>;
  message: string;
  /** Resolved `ckls_` token, or null when none was present. */
  token: string | null;
}

const PRI_RE = /^<(\d{1,3})>/;
const NIL = "-";

/**
 * Parse one RFC 5424 line (already de-framed). Returns null when the line has
 * no `<PRI>` header (unparseable). A missing token yields `token: null` so the
 * caller can count and drop it.
 */
export function parseSyslog5424(raw: string): ParsedSyslog | null {
  const priMatch = PRI_RE.exec(raw);
  if (!priMatch) return null;
  const pri = Number.parseInt(priMatch[1]!, 10);
  const band = bandFromSyslogPri(pri);

  // After `<PRI>`: VERSION SP TIMESTAMP SP HOSTNAME SP APPNAME SP PROCID SP
  // MSGID SP STRUCTURED-DATA [SP MSG]. The first six are space-delimited.
  const afterPri = raw.slice(priMatch[0].length);
  const { fields, rest } = takeFields(afterPri, 6);
  const [, timestamp, hostname, appName, procId, msgId] = fields;

  const { structuredData, message } = parseSdAndMsg(rest);
  const token = resolveToken({ structuredData, message });

  return {
    pri,
    severityNumber: SEVERITY_NUMBER_FOR_BAND[band],
    band,
    ts: parseSyslogTimestamp(timestamp),
    hostname: nilToUndefined(hostname),
    appName: nilToUndefined(appName),
    procId: nilToUndefined(procId),
    msgId: nilToUndefined(msgId),
    structuredData,
    message: token ? stripTokenPrefix(message) : message,
    token,
  };
}

/** Convert a parsed syslog message into a normalized ingest line. */
export function syslogToIngestedLine({
  parsed,
  config,
  now,
}: {
  parsed: ParsedSyslog;
  config: LogStreamConfig;
  now: Date;
}): IngestedLine {
  const attributes: Record<string, unknown> = {};
  if (parsed.hostname) attributes["host.name"] = parsed.hostname;
  if (parsed.appName) attributes["app.name"] = parsed.appName;
  if (parsed.procId) attributes["proc.id"] = parsed.procId;
  if (parsed.msgId) attributes["msg.id"] = parsed.msgId;
  for (const [sdId, params] of Object.entries(parsed.structuredData)) {
    if (sdId.startsWith(CHECKSTACK_SD_ID_PREFIX)) continue;
    for (const [key, value] of Object.entries(params)) {
      attributes[`sd.${sdId}.${key}`] = value;
    }
  }

  const { ts } = clampEventTimestamp({ ts: parsed.ts ?? now, observedAt: now });

  // A per-stream `valueMap` override wins over the PRI-derived band, keyed on
  // the RFC 5424 severity KEYWORD (e.g. PRI 11 -> "err") - the stable,
  // source-native value for syslog (native/OTLP key on their own level field).
  const band = applySeverityValueMap({
    band: parsed.band,
    rawValue: syslogSeverityName(parsed.pri),
    valueMap: config.severityRules?.valueMap,
  });

  return {
    ts,
    observedAt: now,
    severityNumber: parsed.severityNumber,
    band,
    body: truncateBody({ body: parsed.message, maxBytes: config.maxLineBytes }),
    attributes: capAttributes({ attributes }),
  };
}

/**
 * Convert a parsed syslog message into a normalized telemetry log record - the
 * lingua franca a telemetry SOURCE hands the platform, which routes it through
 * the logstream SINK (`createLogstreamTelemetrySink`) into the SAME ingest
 * pipeline the push endpoints use.
 *
 * This is the deliberate INVERSE of {@link syslogToIngestedLine}: instead of
 * banding, truncating, capping and clamping here (the old direct-to-pipeline
 * path), it emits ONLY the source facts and lets the sink apply the identical
 * normalization. Two facts are load-bearing for parity with the old path:
 *
 * - `severityNumber` carries the PRI-derived OTel number, so the sink's
 *   `resolveSeverity` reproduces the same band and number.
 * - `severityText` carries the RFC 5424 severity KEYWORD (e.g. `"err"`), the
 *   source-native value a stream's `severityRules.valueMap` keys on. The old
 *   mapper passed this keyword straight into `applySeverityValueMap` and then
 *   DISCARDED it; the sink keys on `record.severityText`, so preserving it here
 *   keeps the keyword-based band override working AND (as a strict enrichment)
 *   surfaces the keyword on the stored line.
 *
 * No token handling and no `resource`: on the platform path the source instance
 * BINDING is the authorization and routing, and syslog carries no service
 * identity (the host lives in `attributes["host.name"]`, exactly as before).
 */
export function syslogToNormalizedLogRecord({
  parsed,
  now = new Date(),
}: {
  parsed: ParsedSyslog;
  /** Fallback event time when the source sent the nil timestamp `-`. */
  now?: Date;
}): NormalizedLogRecord {
  const attributes: Record<string, unknown> = {};
  if (parsed.hostname) attributes["host.name"] = parsed.hostname;
  if (parsed.appName) attributes["app.name"] = parsed.appName;
  if (parsed.procId) attributes["proc.id"] = parsed.procId;
  if (parsed.msgId) attributes["msg.id"] = parsed.msgId;
  for (const [sdId, params] of Object.entries(parsed.structuredData)) {
    if (sdId.startsWith(CHECKSTACK_SD_ID_PREFIX)) continue;
    for (const [key, value] of Object.entries(params)) {
      attributes[`sd.${sdId}.${key}`] = value;
    }
  }

  return {
    ts: parsed.ts ?? now,
    severityNumber: parsed.severityNumber,
    severityText: syslogSeverityName(parsed.pri),
    body: parsed.message,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
  };
}

// -----------------------------------------------------------------------------
// header field splitting
// -----------------------------------------------------------------------------

function takeFields(
  input: string,
  count: number,
): { fields: string[]; rest: string } {
  const fields: string[] = [];
  let i = 0;
  for (let f = 0; f < count; f += 1) {
    while (i < input.length && input[i] === " ") i += 1;
    const start = i;
    while (i < input.length && input[i] !== " ") i += 1;
    fields.push(input.slice(start, i));
  }
  while (i < input.length && input[i] === " ") i += 1;
  return { fields, rest: input.slice(i) };
}

// -----------------------------------------------------------------------------
// structured data + message
// -----------------------------------------------------------------------------

function parseSdAndMsg(input: string): {
  structuredData: Record<string, Record<string, string>>;
  message: string;
} {
  if (input.startsWith(NIL) && (input.length === 1 || input[1] === " ")) {
    return { structuredData: {}, message: input.slice(2) };
  }
  if (!input.startsWith("[")) {
    // No SD and not the nil marker: treat the whole remainder as MSG.
    return { structuredData: {}, message: input };
  }

  const structuredData: Record<string, Record<string, string>> = {};
  let i = 0;
  while (i < input.length && input[i] === "[") {
    const end = findSdElementEnd(input, i);
    if (end === -1) break;
    const element = input.slice(i + 1, end);
    const { id, params } = parseSdElement(element);
    if (id) structuredData[id] = params;
    i = end + 1;
  }
  if (input[i] === " ") i += 1;
  return { structuredData, message: input.slice(i) };
}

/** Find the closing `]` of an SD-ELEMENT, honoring `\]` inside quoted values. */
function findSdElementEnd(input: string, start: number): number {
  let inQuotes = false;
  for (let i = start + 1; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "\\") {
      i += 1; // skip the escaped character
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "]" && !inQuotes) return i;
  }
  return -1;
}

function parseSdElement(element: string): {
  id: string;
  params: Record<string, string>;
} {
  // `SD-ID (SP name="value")*`
  let i = 0;
  while (i < element.length && element[i] !== " ") i += 1;
  const id = element.slice(0, i);
  const params: Record<string, string> = {};
  const paramRe = /([A-Za-z0-9._@-]+)="((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = paramRe.exec(element.slice(i))) !== null) {
    params[match[1]!] = unescapeSdValue(match[2]!);
  }
  return { id, params };
}

function unescapeSdValue(value: string): string {
  return value.replaceAll(/\\(["\]\\])/g, "$1");
}

// -----------------------------------------------------------------------------
// token resolution
// -----------------------------------------------------------------------------

const MSG_TOKEN_RE = /^@(ckls_[^@\s]+)@\s/;

function resolveToken({
  structuredData,
  message,
}: {
  structuredData: Record<string, Record<string, string>>;
  message: string;
}): string | null {
  for (const [id, params] of Object.entries(structuredData)) {
    if (id.startsWith(CHECKSTACK_SD_ID_PREFIX) && params.token) {
      return params.token;
    }
  }
  const msgMatch = MSG_TOKEN_RE.exec(message);
  if (msgMatch) return msgMatch[1]!;
  return null;
}

function stripTokenPrefix(message: string): string {
  return message.replace(MSG_TOKEN_RE, "");
}

// -----------------------------------------------------------------------------
// misc
// -----------------------------------------------------------------------------

function parseSyslogTimestamp(value: string | undefined): Date | null {
  if (!value || value === NIL) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function nilToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === NIL || value === "" ? undefined : value;
}
