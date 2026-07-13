/**
 * RFC 6587 syslog-over-TCP framing. Supports BOTH framings a client may use on
 * the same connection, auto-detected per message at a frame boundary:
 *
 * - Octet-counting: `MSG-LEN SP SYSLOG-MSG` (a decimal byte count, a space, then
 *   exactly that many bytes). Robust for messages containing newlines.
 * - Non-transparent (LF): messages separated by `\n` (a trailing `\r` is
 *   stripped).
 *
 * The framer buffers partial TCP reads and yields complete, UTF-8 decoded
 * messages. Pure module: no sockets. Unit-tested for split reads and both
 * framings interleaved.
 */

const SPACE = 0x20;
const LF = 0x0A;
const CR = 0x0D;
const ZERO = 0x30;
const NINE = 0x39;

/** Hard cap on a single frame; a longer octet count is treated as a protocol
 * error and the connection buffer is reset to resynchronize. */
export const MAX_SYSLOG_FRAME_BYTES = 5 * 1024 * 1024;

export interface FramerResult {
  messages: string[];
  /** True when a malformed frame forced a buffer reset (caller may log/count). */
  reset: boolean;
}

/** Stateful per-connection syslog framer. */
export class SyslogFramer {
  private buf: Uint8Array = new Uint8Array(0);
  private readonly decoder = new TextDecoder();

  /** Feed a TCP chunk; return any complete messages it completed. */
  push(chunk: Uint8Array): FramerResult {
    this.buf = concat(this.buf, chunk);
    const messages: string[] = [];
    let reset = false;

    for (;;) {
      if (this.buf.length === 0) break;

      const first = this.buf[0]!;
      if (first >= ZERO && first <= NINE) {
        const outcome = this.takeOctetCounted();
        if (outcome === "incomplete") break;
        if (outcome === "reset") {
          reset = true;
          break;
        }
        messages.push(outcome.message);
        continue;
      }

      // Skip a stray leading LF/CR/space between messages.
      if (first === LF || first === CR || first === SPACE) {
        this.buf = this.buf.subarray(1);
        continue;
      }

      const lf = this.buf.indexOf(LF);
      if (lf === -1) {
        if (this.buf.length > MAX_SYSLOG_FRAME_BYTES) {
          this.buf = new Uint8Array(0);
          reset = true;
        }
        break;
      }
      let end = lf;
      if (end > 0 && this.buf[end - 1] === CR) end -= 1;
      messages.push(this.decoder.decode(this.buf.subarray(0, end)));
      this.buf = this.buf.subarray(lf + 1);
    }

    return { messages, reset };
  }

  private takeOctetCounted():
    | { message: string }
    | "incomplete"
    | "reset" {
    let i = 0;
    while (i < this.buf.length && this.buf[i]! >= ZERO && this.buf[i]! <= NINE) {
      i += 1;
    }
    if (i === 0) return "reset";
    if (i >= this.buf.length) return "incomplete"; // digits not yet terminated
    if (this.buf[i] !== SPACE) {
      // Malformed length prefix (digits not followed by a space). Drop the
      // buffered bytes so the connection resynchronizes on the next chunk -
      // WITHOUT this reset the same bytes are re-scanned forever and the
      // connection is permanently wedged.
      this.buf = new Uint8Array(0);
      return "reset";
    }

    const len = Number.parseInt(
      this.decoder.decode(this.buf.subarray(0, i)),
      10,
    );
    if (!Number.isFinite(len) || len < 0 || len > MAX_SYSLOG_FRAME_BYTES) {
      this.buf = new Uint8Array(0);
      return "reset";
    }
    const msgStart = i + 1;
    if (this.buf.length < msgStart + len) return "incomplete";

    const message = this.decoder.decode(
      this.buf.subarray(msgStart, msgStart + len),
    );
    this.buf = this.buf.subarray(msgStart + len);
    return { message };
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
