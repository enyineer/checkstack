import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Proposal token codec (decision §13.4).
 *
 * A proposal is a row in `ai_tool_calls` with `status = "proposed"`. The opaque
 * token handed to the caller is `propose:<rowId>.<nonce>`. `apply` parses it,
 * fetches the row by id, and accepts only if the row is still `proposed`, the
 * nonce matches in CONSTANT TIME, and the TTL has not elapsed.
 *
 * This module is pure (no DB) so the token grammar + constant-time compare are
 * unit-tested in isolation.
 */

const TOKEN_PREFIX = "propose:";
const NONCE_BYTES = 32;

export interface ParsedProposalToken {
  rowId: string;
  nonce: string;
}

/** A fresh, cryptographically-random nonce (hex). */
export function generateProposalNonce(): string {
  return randomBytes(NONCE_BYTES).toString("hex");
}

/** Build the opaque token for a proposal row. */
export function formatProposalToken({
  rowId,
  nonce,
}: ParsedProposalToken): string {
  return `${TOKEN_PREFIX}${rowId}.${nonce}`;
}

/**
 * Parse an opaque proposal token. Returns `undefined` for any malformed token
 * (wrong prefix, missing separator, empty id/nonce) so callers reject without
 * branching on a thrown error.
 */
export function parseProposalToken(
  token: string,
): ParsedProposalToken | undefined {
  if (!token.startsWith(TOKEN_PREFIX)) return undefined;
  const body = token.slice(TOKEN_PREFIX.length);
  // The rowId is a UUID (no dots); the nonce is hex (no dots). Split on the
  // FIRST dot so a row id is never confused with the nonce.
  const sep = body.indexOf(".");
  if (sep <= 0) return undefined;
  const rowId = body.slice(0, sep);
  const nonce = body.slice(sep + 1);
  if (!rowId || !nonce) return undefined;
  return { rowId, nonce };
}

/**
 * Constant-time nonce comparison. Length-mismatched / non-hex inputs return
 * false without leaking timing about the stored nonce.
 */
export function nonceMatches({
  candidate,
  stored,
}: {
  candidate: string;
  stored: string;
}): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(stored, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
