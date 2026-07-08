import snmp, { type V3User, type Varbind } from "net-snmp";
import type { RawSnmpVarbind } from "./snmp-varbind";
import type { SnmpConfig } from "./schemas";

/**
 * A connected SNMP session bound to a single agent + credentials. `get` reads
 * one OID; the promise REJECTS only on a transport failure (unreachable socket,
 * timeout, v3 auth handshake failure) - an exception varbind is a resolved,
 * completed response and is handled by the caller.
 */
export interface SnmpSession {
  get(oid: string): Promise<RawSnmpVarbind>;
  close(): void;
}

/** Builds an {@link SnmpSession} from validated strategy config (injectable for tests). */
export type SnmpSessionFactory = (config: SnmpConfig) => SnmpSession;

/**
 * The subset of a `net-snmp` `Session` this plugin consumes: a callback-style
 * `get`, an `error` EventEmitter surface, and `close`. Kept as a seam so the
 * error-handling wiring in {@link createSnmpSession} can be unit-tested without
 * a real socket.
 */
export interface RawSnmpSession {
  get(
    oids: string[],
    callback: (error: Error | null, varbinds: Varbind[]) => void,
  ): void;
  on(event: "error", listener: (error: Error) => void): void;
  removeListener(event: "error", listener: (error: Error) => void): void;
  close(): void;
}

/** Creates the underlying `net-snmp` session (injectable for tests). */
export type RawSnmpSessionFactory = (config: SnmpConfig) => RawSnmpSession;

/**
 * Shared no-op `error` listener. Attaching ANY listener is what prevents Node
 * from throwing on an unhandled `error` event; a stray inbound datagram error
 * is thereby contained and the affected run just fails / times out via `get`.
 * A single shared reference is safe: `EventEmitter` tracks listeners per session
 * and `removeListener` strips exactly this reference from the session it was
 * added to on `close()`.
 */
const swallowSessionError = (): void => {};

/** SNMP protocol version string -> `net-snmp` numeric version. */
function toSnmpVersion(version: SnmpConfig["version"]): number {
  switch (version) {
    case "1": {
      return snmp.Version1;
    }
    case "3": {
      return snmp.Version3;
    }
    default: {
      return snmp.Version2c;
    }
  }
}

/** Map the validated v3 fields onto a `net-snmp` user descriptor. */
function buildV3User(config: SnmpConfig): V3User {
  const level = snmp.SecurityLevel[config.v3SecurityLevel];
  const user: V3User = {
    name: config.v3Username ?? "",
    level,
  };
  if (config.v3AuthProtocol) {
    user.authProtocol = snmp.AuthProtocols[config.v3AuthProtocol];
  }
  if (config.v3AuthKey !== undefined) {
    user.authKey = config.v3AuthKey;
  }
  if (config.v3PrivProtocol) {
    user.privProtocol = snmp.PrivProtocols[config.v3PrivProtocol];
  }
  if (config.v3PrivKey !== undefined) {
    user.privKey = config.v3PrivKey;
  }
  return user;
}

/**
 * Default raw-session factory: builds a real `net-snmp` session. `retries: 0`
 * because the health-check engine owns retry/scheduling policy - one probe per
 * run.
 */
export const defaultRawSnmpSessionFactory: RawSnmpSessionFactory = (config) => {
  const options = {
    port: config.port,
    timeout: config.timeout,
    retries: 0,
    version: toSnmpVersion(config.version),
  } as const;

  return config.version === "3"
    ? snmp.createV3Session(config.host, buildV3User(config), options)
    : snmp.createSession(config.host, config.community, options);
};

/**
 * Wrap a {@link RawSnmpSession} into the {@link SnmpSession} the strategy uses.
 *
 * Critically, this attaches an `error` listener to the raw session. `net-snmp`'s
 * `Session` is an `EventEmitter` and emits a Node `error` event when an inbound
 * datagram cannot be parsed / decrypted (e.g. a malformed or wrong-key v3
 * response). That emit fires from inside the dgram receive callback - OUTSIDE
 * the `try/catch` around `get()` - so with NO listener attached Node throws
 * `Unhandled 'error' event` and crashes the entire worker pod, taking down every
 * other health check on it, not just this run. We contain it to a no-op: the
 * affected run simply fails or times out normally via the `get` callback. The
 * listener is removed on `close()` so it never leaks across sessions.
 */
export function createSnmpSession({
  config,
  rawSessionFactory = defaultRawSnmpSessionFactory,
}: {
  config: SnmpConfig;
  rawSessionFactory?: RawSnmpSessionFactory;
}): SnmpSession {
  const session = rawSessionFactory(config);

  // Contain stray inbound errors so they cannot become an unhandled-error crash.
  session.on("error", swallowSessionError);

  return {
    get(oid: string): Promise<RawSnmpVarbind> {
      return new Promise<RawSnmpVarbind>((resolve, reject) => {
        session.get([oid], (error, varbinds) => {
          if (error) {
            reject(error);
            return;
          }
          const varbind = varbinds[0];
          if (!varbind) {
            reject(new Error("SNMP GET returned no varbinds"));
            return;
          }
          resolve({ type: varbind.type, value: varbind.value });
        });
      });
    },
    close(): void {
      session.removeListener("error", swallowSessionError);
      session.close();
    },
  };
}

/**
 * Default factory: builds a real, error-contained `net-snmp` session from
 * validated strategy config.
 */
export const defaultSnmpSessionFactory: SnmpSessionFactory = (config) =>
  createSnmpSession({ config });
