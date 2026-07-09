import { describe, expect, it } from "bun:test";
import { normalizeVarbind, SnmpType } from "./snmp-varbind";

describe("normalizeVarbind", () => {
  it("normalizes an Integer to a numeric value and string", () => {
    const result = normalizeVarbind({ type: SnmpType.Integer, value: 42 });
    expect(result).toEqual({
      typeName: "Integer",
      numericValue: 42,
      stringValue: "42",
    });
  });

  it("normalizes a Counter32 numeric value", () => {
    const result = normalizeVarbind({ type: SnmpType.Counter32, value: 1000 });
    expect(result.typeName).toBe("Counter32");
    expect(result.numericValue).toBe(1000);
    expect(result.stringValue).toBe("1000");
  });

  it("renders an OctetString buffer to text", () => {
    const result = normalizeVarbind({
      type: SnmpType.OctetString,
      value: Buffer.from("router-1", "utf8"),
    });
    expect(result.typeName).toBe("OctetString");
    expect(result.stringValue).toBe("router-1");
    expect(result.numericValue).toBeUndefined();
  });

  it("passes through an OID / IpAddress string value", () => {
    const oid = normalizeVarbind({ type: SnmpType.OID, value: "1.3.6.1.2.1" });
    expect(oid).toEqual({
      typeName: "OID",
      stringValue: "1.3.6.1.2.1",
    });
    const ip = normalizeVarbind({
      type: SnmpType.IpAddress,
      value: "10.0.0.1",
    });
    expect(ip.typeName).toBe("IpAddress");
    expect(ip.stringValue).toBe("10.0.0.1");
  });

  it("keeps a Counter64 value exact in stringValue (no crash above 2^53)", () => {
    // 18446744073709551615 = 2^64 - 1, the max Counter64, as a big-endian buffer.
    const buffer = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const result = normalizeVarbind({ type: SnmpType.Counter64, value: buffer });
    expect(result.typeName).toBe("Counter64");
    expect(result.stringValue).toBe("18446744073709551615");
    // Best-effort number is finite (may lose precision - that is documented).
    expect(Number.isFinite(result.numericValue)).toBe(true);
  });

  it("normalizes a small Counter64 exactly, including numericValue", () => {
    const buffer = Buffer.from([0, 0, 0, 0, 0, 0, 0, 123]);
    const result = normalizeVarbind({ type: SnmpType.Counter64, value: buffer });
    expect(result.stringValue).toBe("123");
    expect(result.numericValue).toBe(123);
  });

  it.each([
    [SnmpType.NoSuchObject, "noSuchObject"],
    [SnmpType.NoSuchInstance, "noSuchInstance"],
    [SnmpType.EndOfMibView, "endOfMibView"],
  ])(
    "maps exception varbind %p to an assertable sentinel, never an error",
    (type, expectedName) => {
      const result = normalizeVarbind({ type, value: null });
      expect(result.typeName).toBe(expectedName);
      expect(result.stringValue).toBe(expectedName);
      expect(result.numericValue).toBeUndefined();
    },
  );

  it("maps a boolean value to 0/1 and its string form", () => {
    expect(normalizeVarbind({ type: SnmpType.Boolean, value: true })).toEqual({
      typeName: "Boolean",
      numericValue: 1,
      stringValue: "true",
    });
  });

  it("handles a null / Null value without throwing", () => {
    const result = normalizeVarbind({ type: SnmpType.Null, value: null });
    expect(result.typeName).toBe("Null");
    expect(result.stringValue).toBe("");
  });
});
