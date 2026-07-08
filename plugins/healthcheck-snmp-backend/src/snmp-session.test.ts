import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import type { Varbind } from "net-snmp";
import { createSnmpSession, type RawSnmpSession } from "./snmp-session";
import { SnmpType } from "./snmp-varbind";
import { snmpConfigSchema } from "./schemas";

/**
 * A fake raw session backed by a real `EventEmitter`, so `emit("error", ...)`
 * has the exact Node semantics the fix guards against: with NO listener a Node
 * `error` event THROWS; with a listener it is delivered and swallowed. Using a
 * real EventEmitter is what makes the regression meaningful.
 */
class FakeRawSession extends EventEmitter implements RawSnmpSession {
  close = mock(() => {});

  get(
    _oids: string[],
    callback: (error: Error | null, varbinds: Varbind[]) => void,
  ): void {
    callback(null, [
      { oid: "1.3.6.1.2.1.1.3.0", type: SnmpType.Integer, value: 7 },
    ]);
  }
}

const config = snmpConfigSchema.parse({ host: "127.0.0.1" });

describe("createSnmpSession error containment", () => {
  it("swallows an inbound session 'error' instead of crashing the worker", () => {
    const raw = new FakeRawSession();
    const session = createSnmpSession({ config, rawSessionFactory: () => raw });

    // A listener is attached, so a malformed-datagram 'error' is delivered and
    // contained. Without the fix (no listener) this emit would THROW an
    // unhandled 'error' and take down the whole worker pod.
    expect(() =>
      raw.emit("error", new Error("malformed SNMP datagram")),
    ).not.toThrow();

    session.close();
  });

  it("removes its 'error' listener on close (no leak across sessions)", () => {
    const raw = new FakeRawSession();
    const session = createSnmpSession({ config, rawSessionFactory: () => raw });
    expect(raw.listenerCount("error")).toBe(1);

    session.close();

    // Listener removed AND the underlying session closed.
    expect(raw.listenerCount("error")).toBe(0);
    expect(raw.close).toHaveBeenCalledTimes(1);
    // With the listener gone, an 'error' now throws again - proving the
    // containment is exactly scoped to the session's lifetime.
    expect(() => raw.emit("error", new Error("after close"))).toThrow(
      "after close",
    );
  });

  it("still resolves a normal GET through the wrapped session", async () => {
    const raw = new FakeRawSession();
    const session = createSnmpSession({ config, rawSessionFactory: () => raw });

    const varbind = await session.get("1.3.6.1.2.1.1.3.0");
    expect(varbind.type).toBe(SnmpType.Integer);
    expect(varbind.value).toBe(7);

    session.close();
  });
});
