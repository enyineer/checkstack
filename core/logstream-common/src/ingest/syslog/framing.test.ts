import { describe, it, expect } from "bun:test";
import { SyslogFramer } from "./framing";

const enc = (s: string) => new TextEncoder().encode(s);

describe("SyslogFramer", () => {
  it("frames LF-delimited messages, stripping a trailing CR", () => {
    const framer = new SyslogFramer();
    const { messages } = framer.push(enc("<11>1 msg one\n<12>1 msg two\r\n"));
    expect(messages).toEqual(["<11>1 msg one", "<12>1 msg two"]);
  });

  it("frames octet-counted messages (embedded newlines survive)", () => {
    const framer = new SyslogFramer();
    const body = "<11>1 line\nwith newline";
    const { messages } = framer.push(enc(`${body.length} ${body}`));
    expect(messages).toEqual([body]);
  });

  it("reassembles a message split across two TCP reads", () => {
    const framer = new SyslogFramer();
    const body = "<11>1 hello world";
    const framed = `${body.length} ${body}`;
    const first = framer.push(enc(framed.slice(0, 5)));
    expect(first.messages).toEqual([]);
    const second = framer.push(enc(framed.slice(5)));
    expect(second.messages).toEqual([body]);
  });

  it("handles octet-counted and LF-framed messages interleaved", () => {
    const framer = new SyslogFramer();
    const octet = "<11>1 a";
    const chunk = `${octet.length} ${octet}<12>1 b\n`;
    const { messages } = framer.push(enc(chunk));
    expect(messages).toEqual([octet, "<12>1 b"]);
  });

  it("resets on a malformed octet length and reports it", () => {
    const framer = new SyslogFramer();
    const { messages, reset } = framer.push(enc("12x garbage"));
    expect(messages).toEqual([]);
    expect(reset).toBe(true);
  });

  it("recovers after a malformed length prefix (does not wedge the connection)", () => {
    const framer = new SyslogFramer();
    // A malformed length prefix (digits not followed by a space) must clear the
    // buffer, not leave the same bytes to be re-scanned forever.
    const first = framer.push(enc("12x garbage"));
    expect(first.reset).toBe(true);
    expect(first.messages).toEqual([]);

    // A subsequent, valid octet-counted frame parses cleanly - proving the
    // connection resynchronized rather than staying wedged on the bad bytes.
    const body = "<11>1 recovered";
    const second = framer.push(enc(`${body.length} ${body}`));
    expect(second.reset).toBe(false);
    expect(second.messages).toEqual([body]);
  });
});
