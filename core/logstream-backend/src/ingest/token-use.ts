/**
 * Tracks token `lastUsedAt` updates, throttled to at most once per minute per
 * token. On a successful ingest the endpoint records the token; the flush cycle
 * drains the pending set and folds the updates into ONE batched write, so the
 * hot request path never touches `log_stream_tokens` (plan §5 auth).
 *
 * Pod-local: each pod tracks and writes its own tokens' usage; `lastUsedAt`
 * advances monotonically in the DB (`greatest`), so concurrent pods converge.
 */

const MINUTE_MS = 60_000;

export interface PendingTokenUse {
  tokenId: string;
  at: Date;
}

export class TokenUseTracker {
  private readonly pending = new Map<string, Date>();
  private readonly lastMinute = new Map<string, number>();

  /** Record a token use; ignored if already recorded this minute. */
  record({ tokenId, at }: { tokenId: string; at: Date }): void {
    const minute = Math.floor(at.getTime() / MINUTE_MS);
    if (this.lastMinute.get(tokenId) === minute) return;
    this.lastMinute.set(tokenId, minute);
    this.pending.set(tokenId, at);
  }

  /** Drain the pending updates for the flush to persist. */
  drain(): PendingTokenUse[] {
    if (this.pending.size === 0) return [];
    const out: PendingTokenUse[] = [];
    for (const [tokenId, at] of this.pending) out.push({ tokenId, at });
    this.pending.clear();
    return out;
  }
}
