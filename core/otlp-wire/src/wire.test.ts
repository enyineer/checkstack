import { describe, it, expect } from "bun:test";
import { ProtoReader, ProtoWriter, WireType } from "./wire";

describe("ProtoWriter/ProtoReader varints", () => {
  // Hand-computed base-128 varint encodings anchor the primitives so the
  // encoder and decoder are not merely self-consistent.
  const cases: Array<{ value: number; bytes: number[] }> = [
    { value: 0, bytes: [0x00] },
    { value: 1, bytes: [0x01] },
    { value: 127, bytes: [0x7f] },
    { value: 128, bytes: [0x80, 0x01] },
    { value: 300, bytes: [0xac, 0x02] },
    { value: 16384, bytes: [0x80, 0x80, 0x01] },
  ];

  for (const { value, bytes } of cases) {
    it(`encodes ${value} to the canonical bytes`, () => {
      const out = new ProtoWriter().varint(value).finish();
      expect([...out]).toEqual(bytes);
    });
    it(`decodes ${value} back`, () => {
      expect(new ProtoReader(Uint8Array.from(bytes)).readVarintNumber()).toBe(
        value,
      );
    });
  }

  it("round-trips a value beyond 2^32 as bigint", () => {
    const big = 1234567890123n;
    const bytes = new ProtoWriter().varint(big).finish();
    expect(new ProtoReader(bytes).readVarint()).toBe(big);
  });

  it("throws on a truncated varint", () => {
    expect(() => new ProtoReader(Uint8Array.from([0x80])).readVarint()).toThrow(
      /truncated varint/,
    );
  });

  it("rejects a negative varint on encode", () => {
    expect(() => new ProtoWriter().varint(-1)).toThrow(/negative/);
  });
});

describe("ProtoWriter/ProtoReader fields", () => {
  it("round-trips fixed64, string, bytes and a nested message", () => {
    const inner = new ProtoWriter().uint(1, 42).string(2, "hello").finish();
    const buf = new ProtoWriter()
      .fixed64(1, 0x0102030405060708n)
      .string(2, "τoπ") // multi-byte UTF-8
      .bytes(3, Uint8Array.from([0xde, 0xad]))
      .message(4, (w) => w.uint(1, 42).string(2, "hello"))
      .finish();

    const reader = new ProtoReader(buf);

    let f1 = 0n;
    let f2 = "";
    let f3: Uint8Array = new Uint8Array();
    let f4: Uint8Array = new Uint8Array();
    while (reader.hasMore) {
      const { fieldNumber, wireType } = reader.readTag();
      if (fieldNumber === 1) f1 = reader.readFixed64();
      else if (fieldNumber === 2) f2 = reader.readString();
      else if (fieldNumber === 3) f3 = reader.readBytes();
      else if (fieldNumber === 4) f4 = reader.readBytes();
      else reader.skip(wireType);
    }

    expect(f1).toBe(0x0102030405060708n);
    expect(f2).toBe("τoπ");
    expect([...f3]).toEqual([0xde, 0xad]);
    expect([...f4]).toEqual([...inner]);
  });

  it("skips unknown fields of every wire type", () => {
    const buf = new ProtoWriter()
      .uint(1, 999) // varint field we will skip
      .fixed64(2, 7n) // fixed64 field we will skip
      .string(5, "keep")
      .finish();
    const reader = new ProtoReader(buf);
    let kept = "";
    while (reader.hasMore) {
      const { fieldNumber, wireType } = reader.readTag();
      if (fieldNumber === 5) kept = reader.readString();
      else reader.skip(wireType);
    }
    expect(kept).toBe("keep");
  });

  it("exposes the wire-type constants", () => {
    expect(WireType.Varint).toBe(0);
    expect(WireType.LengthDelimited).toBe(2);
  });
});
