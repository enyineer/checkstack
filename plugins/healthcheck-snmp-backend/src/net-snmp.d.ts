/**
 * Minimal ambient typings for the subset of `net-snmp` this plugin uses.
 * The package ships no declarations; declaring only what we call keeps the
 * surface fully typed without an `any` or a stale `@types` dependency.
 */
declare module "net-snmp" {
  export interface Varbind {
    oid: string;
    type: number;
    value: number | string | boolean | Buffer | null;
  }

  export interface Session {
    get(
      oids: string[],
      callback: (error: Error | null, varbinds: Varbind[]) => void,
    ): void;
    close(): void;
    on(event: "error", listener: (error: Error) => void): void;
    removeListener(event: "error", listener: (error: Error) => void): void;
  }

  export interface SessionOptions {
    port?: number;
    version?: number;
    timeout?: number;
    retries?: number;
    transport?: "udp4" | "udp6";
  }

  export interface V3User {
    name: string;
    level: number;
    authProtocol?: number;
    authKey?: string;
    privProtocol?: number;
    privKey?: string;
  }

  export function createSession(
    target: string,
    community: string,
    options?: SessionOptions,
  ): Session;

  export function createV3Session(
    target: string,
    user: V3User,
    options?: SessionOptions,
  ): Session;

  interface Snmp {
    createSession: typeof createSession;
    createV3Session: typeof createV3Session;
    Version1: number;
    Version2c: number;
    Version3: number;
    ObjectType: Record<string, number>;
    SecurityLevel: Record<string, number>;
    AuthProtocols: Record<string, number>;
    PrivProtocols: Record<string, number>;
  }

  const snmp: Snmp;
  export default snmp;
}
