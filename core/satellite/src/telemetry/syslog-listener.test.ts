import { describe, it, expect } from "bun:test";
import {
  processSyslogMessages,
  readSatelliteSyslogEnvConfig,
} from "./syslog-listener";

const NOW = new Date("2026-07-13T00:00:00.000Z");

const withSdToken = (token: string, msg: string) =>
  `<13>1 2026-07-13T00:00:00Z host app 1 - [checkstack@50501 token="${token}"] ${msg}`;

const withMsgPrefixToken = (token: string, msg: string) =>
  `<11>1 2026-07-13T00:00:00Z host app 1 - - @${token}@ ${msg}`;

const noToken = (msg: string) =>
  `<13>1 2026-07-13T00:00:00Z host app 1 - - ${msg}`;

describe("processSyslogMessages", () => {
  it("resolves a token from an SD element and groups lines by token", () => {
    const result = processSyslogMessages({
      messages: [
        withSdToken("ckls_a_1", "hello"),
        withSdToken("ckls_a_1", "world"),
      ],
      now: NOW,
    });
    expect(result.droppedNoToken).toBe(0);
    expect(result.droppedUnparseable).toBe(0);
    const lines = result.byToken.get("ckls_a_1");
    expect(lines).toHaveLength(2);
    expect(lines!.map((l) => l.body)).toEqual(["hello", "world"]);
  });

  it("resolves a token from a MSG prefix and strips it from the body", () => {
    const result = processSyslogMessages({
      messages: [withMsgPrefixToken("ckls_b_2", "boom")],
      now: NOW,
    });
    const lines = result.byToken.get("ckls_b_2");
    expect(lines).toHaveLength(1);
    expect(lines![0]!.body).toBe("boom");
  });

  it("separates lines by their distinct tokens", () => {
    const result = processSyslogMessages({
      messages: [
        withSdToken("ckls_a_1", "one"),
        withSdToken("ckls_c_3", "two"),
      ],
      now: NOW,
    });
    expect([...result.byToken.keys()].sort()).toEqual(["ckls_a_1", "ckls_c_3"]);
  });

  it("counts messages with no resolvable token", () => {
    const result = processSyslogMessages({
      messages: [noToken("just a message")],
      now: NOW,
    });
    expect(result.droppedNoToken).toBe(1);
    expect(result.byToken.size).toBe(0);
  });

  it("counts unparseable (no <PRI>) messages", () => {
    const result = processSyslogMessages({
      messages: ["not a syslog line at all"],
      now: NOW,
    });
    expect(result.droppedUnparseable).toBe(1);
    expect(result.byToken.size).toBe(0);
  });
});

describe("readSatelliteSyslogEnvConfig", () => {
  it("returns null when the port is unset", () => {
    expect(readSatelliteSyslogEnvConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("parses port + TLS + host from the environment", () => {
    const config = readSatelliteSyslogEnvConfig({
      CHECKSTACK_SATELLITE_SYSLOG_PORT: "6514",
      CHECKSTACK_SATELLITE_SYSLOG_HOST: "127.0.0.1",
      CHECKSTACK_SATELLITE_SYSLOG_TLS_CERT: "/cert.pem",
      CHECKSTACK_SATELLITE_SYSLOG_TLS_KEY: "/key.pem",
    } as unknown as NodeJS.ProcessEnv);
    expect(config).toMatchObject({
      port: 6514,
      hostname: "127.0.0.1",
      tlsCertPath: "/cert.pem",
      tlsKeyPath: "/key.pem",
      maxConnections: 100,
    });
  });
});
