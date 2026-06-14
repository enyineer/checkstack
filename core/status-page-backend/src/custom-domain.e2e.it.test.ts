import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import dgram from "node:dgram";
import { Resolver } from "node:dns/promises";
import type { Logger, RpcClient, SafeDatabase } from "@checkstack/backend-api";
import { customDomainTxtRecordName } from "@checkstack/status-page-common";
import { verifyDomainTxt } from "./custom-domain";
import { StatusPageService } from "./service";
import type { WidgetTypeRegistry } from "./widget-registry";
import type { StatusPageRow } from "./schema";
import * as schema from "./schema";

/**
 * E2E for custom-domain DNS verification against a REAL (fake) DNS server.
 *
 * A tiny UDP DNS server answers TXT queries from an in-memory map; a real
 * `node:dns` Resolver is pointed at it (custom port), so `verifyDomainTxt` and
 * `service.verifyCustomDomain` run the actual DNS code path over the wire - not
 * a mocked resolver. The "domain" (`status.fake.test`) is fake but the protocol
 * is real.
 */

interface FakeDns {
  resolver: Resolver;
  setTxt(name: string, value: string | null): void;
  close(): Promise<void>;
}

/** Minimal UDP DNS server: answers a single TXT question from `records`. */
async function startFakeDns(): Promise<FakeDns> {
  const records = new Map<string, string>();
  const server = dgram.createSocket("udp4");

  server.on("message", (msg, rinfo) => {
    // Parse the question name (length-prefixed labels until a 0 byte).
    let i = 12;
    const labels: string[] = [];
    while (msg[i] !== 0) {
      const len = msg[i]!;
      labels.push(msg.subarray(i + 1, i + 1 + len).toString("ascii"));
      i += len + 1;
    }
    const qEnd = i + 1 + 4; // zero byte + qtype(2) + qclass(2)
    const value = records.get(labels.join("."));

    const header = Buffer.alloc(12);
    msg.copy(header, 0, 0, 2); // echo query id
    header.writeUInt16BE(0x8180, 2); // standard response, no error
    header.writeUInt16BE(1, 4); // QDCOUNT
    header.writeUInt16BE(value ? 1 : 0, 6); // ANCOUNT

    const question = msg.subarray(12, qEnd);
    let answer = Buffer.alloc(0);
    if (value) {
      const txt = Buffer.from(value, "utf8");
      const rdata = Buffer.concat([Buffer.from([txt.length]), txt]);
      answer = Buffer.alloc(12 + rdata.length);
      answer.writeUInt16BE(0xc00c, 0); // name pointer -> offset 12
      answer.writeUInt16BE(16, 2); // TYPE TXT
      answer.writeUInt16BE(1, 4); // CLASS IN
      answer.writeUInt32BE(60, 6); // TTL
      answer.writeUInt16BE(rdata.length, 10);
      rdata.copy(answer, 12);
    }
    server.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
  });

  await new Promise<void>((res) => server.bind(0, "127.0.0.1", () => res()));
  const port = (server.address() as { port: number }).port;
  const resolver = new Resolver();
  resolver.setServers([`127.0.0.1:${port}`]);

  return {
    resolver,
    setTxt: (name, value) =>
      value === null ? records.delete(name) : void records.set(name, value),
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

const TOKEN = "cs-verify-7e3a1b90-fake-token";

// A fresh domain per assertion: node:dns caches resolved names, so reusing one
// host across tests would serve a stale cached answer after we change the record.
let domainCounter = 0;
function freshDomain(): string {
  domainCounter += 1;
  return `status-${domainCounter}.fake.test`;
}

let dns: FakeDns;
beforeAll(async () => {
  dns = await startFakeDns();
});
afterAll(async () => {
  await dns.close();
});

const resolveTxt = (name: string) => dns.resolver.resolveTxt(name);

describe("verifyDomainTxt against a real (fake) DNS server", () => {
  test("returns true when the TXT record matches the token", async () => {
    const record = customDomainTxtRecordName(freshDomain());
    dns.setTxt(record, TOKEN);
    expect(
      await verifyDomainTxt({ recordName: record, token: TOKEN, resolveTxt }),
    ).toBe(true);
  });

  test("returns false when the TXT value does not match", async () => {
    const record = customDomainTxtRecordName(freshDomain());
    dns.setTxt(record, "some-other-value");
    expect(
      await verifyDomainTxt({ recordName: record, token: TOKEN, resolveTxt }),
    ).toBe(false);
  });

  test("returns false when there is no record (NXDOMAIN/ENODATA)", async () => {
    const record = customDomainTxtRecordName(freshDomain());
    expect(
      await verifyDomainTxt({ recordName: record, token: TOKEN, resolveTxt }),
    ).toBe(false);
  });
});

// ---- Full service.verifyCustomDomain flow (real DNS + service + fake DB) ----

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;
const noRpc: RpcClient = { forPlugin: () => ({}) as never };
const emptyRegistry: WidgetTypeRegistry = {
  register: () => {},
  get: () => undefined,
  list: () => [],
};

function row(over: Partial<StatusPageRow>): StatusPageRow {
  return {
    id: "p1",
    slug: "acme",
    title: "Acme",
    visibility: "public",
    theme: { mode: "auto" },
    draftLayout: [],
    publishedLayout: null,
    publishedAt: null,
    customDomain: null,
    customDomainToken: TOKEN,
    customDomainVerifiedAt: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  } as StatusPageRow;
}

/** Stateful fake DB supporting requireRow (select) + update().set().returning(). */
function statefulDb(initial: StatusPageRow): {
  db: SafeDatabase<typeof schema>;
  current: () => StatusPageRow;
} {
  const state = { row: initial };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [state.row] }),
      }),
    }),
    update: () => ({
      set: (vals: Partial<StatusPageRow>) => ({
        where: () => ({
          returning: async () => {
            state.row = { ...state.row, ...vals };
            return [state.row];
          },
        }),
      }),
    }),
  } as unknown as SafeDatabase<typeof schema>;
  return { db, current: () => state.row };
}

function makeService(db: SafeDatabase<typeof schema>): StatusPageService {
  return new StatusPageService({
    db,
    registry: emptyRegistry,
    rpcClient: noRpc,
    logger: noopLogger,
    txtResolver: (name) => dns.resolver.resolveTxt(name),
    primaryHost: null,
  });
}

describe("service.verifyCustomDomain end-to-end", () => {
  test("marks the domain verified when the DNS TXT record is present", async () => {
    const domain = freshDomain();
    dns.setTxt(customDomainTxtRecordName(domain), TOKEN);
    const { db, current } = statefulDb(row({ customDomain: domain }));
    const page = await makeService(db).verifyCustomDomain({ id: "p1" });
    expect(page.customDomain?.verified).toBe(true);
    expect(current().customDomainVerifiedAt).not.toBeNull();
  });

  test("rejects (and leaves unverified) when the TXT record is missing", async () => {
    const domain = freshDomain(); // no record set -> lookup fails
    const { db, current } = statefulDb(row({ customDomain: domain }));
    await expect(
      makeService(db).verifyCustomDomain({ id: "p1" }),
    ).rejects.toThrow(/TXT record/i);
    expect(current().customDomainVerifiedAt).toBeNull();
  });
});
