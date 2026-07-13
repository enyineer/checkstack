/**
 * A minimal, dependency-free protobuf wire-format codec - just enough to decode
 * OTLP export requests and encode their responses.
 *
 * Why hand-rolled instead of `protobufjs` / `@bufbuild/protobuf`: the OTLP
 * message sets are small and stable, and the wire format is trivial (four wire
 * types). A compact reader/writer is the lightest maintained option - zero
 * runtime dependencies, zero committed generated code, and fully unit-testable
 * against hand-computed byte fixtures.
 *
 * Pure module: no IO. The reader tolerates unknown fields (skips them) so a
 * newer OTLP producer never breaks decoding.
 */

/** Protobuf wire types (the low 3 bits of a field tag). */
export const WireType = {
  Varint: 0,
  Fixed64: 1,
  LengthDelimited: 2,
  Fixed32: 5,
} as const;

export type WireTypeValue = (typeof WireType)[keyof typeof WireType];

/** A decoded field header: its field number and wire type. */
export interface FieldHeader {
  fieldNumber: number;
  wireType: number;
}

/**
 * Streaming reader over a protobuf-encoded byte buffer. Reads one field at a
 * time; the caller dispatches on {@link FieldHeader.fieldNumber} and reads the
 * matching value, or calls {@link skip} for fields it does not care about.
 */
export class ProtoReader {
  private readonly view: DataView;
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** True while there are more bytes to read. */
  get hasMore(): boolean {
    return this.pos < this.buf.length;
  }

  /** Read the next field tag, splitting it into field number + wire type. */
  readTag(): FieldHeader {
    const tag = this.readVarint();
    const num = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    if (num <= 0) {
      throw new Error(`protobuf: invalid field number ${num}`);
    }
    return { fieldNumber: num, wireType };
  }

  /** Read a base-128 varint as a bigint (handles the full 64-bit range). */
  readVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (this.pos >= this.buf.length) {
        throw new Error("protobuf: truncated varint");
      }
      const byte = this.buf[this.pos]!;
      this.pos += 1;
      result |= BigInt(byte & 0x7F) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
      if (shift > 63n) {
        throw new Error("protobuf: varint overflow");
      }
    }
    return result;
  }

  /** Read a varint as a JS number (safe for values below 2^53). */
  readVarintNumber(): number {
    return Number(this.readVarint());
  }

  /** Read a little-endian fixed 64-bit value as a bigint. */
  readFixed64(): bigint {
    this.ensure(8);
    const lo = BigInt(this.view.getUint32(this.pos, true));
    const hi = BigInt(this.view.getUint32(this.pos + 4, true));
    this.pos += 8;
    return lo | (hi << 32n);
  }

  /** Read a little-endian IEEE-754 double. */
  readDouble(): number {
    this.ensure(8);
    const value = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return value;
  }

  /** Read a little-endian fixed 32-bit unsigned value. */
  readFixed32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  /** Read a length-delimited byte slice (a copy). */
  readBytes(): Uint8Array {
    const len = this.readVarintNumber();
    this.ensure(len);
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  /** Read a length-delimited value as a UTF-8 string. */
  readString(): string {
    return new TextDecoder().decode(this.readBytes());
  }

  /** Skip the value for a field of the given wire type. */
  skip(wireType: number): void {
    switch (wireType) {
      case WireType.Varint: {
        this.readVarint();
        return;
      }
      case WireType.Fixed64: {
        this.ensure(8);
        this.pos += 8;
        return;
      }
      case WireType.LengthDelimited: {
        this.readBytes();
        return;
      }
      case WireType.Fixed32: {
        this.ensure(4);
        this.pos += 4;
        return;
      }
      default: {
        throw new Error(`protobuf: unsupported wire type ${wireType}`);
      }
    }
  }

  private ensure(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error("protobuf: unexpected end of buffer");
    }
  }
}

/**
 * Streaming writer producing a protobuf byte buffer. Only the primitives OTLP
 * needs are implemented (varint, fixed64, length-delimited, sub-messages).
 */
export class ProtoWriter {
  private chunks: number[] = [];

  /** Append a raw varint (no tag). */
  varint(value: bigint | number): this {
    let v = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
    if (v < 0n) {
      throw new Error("protobuf: cannot encode a negative varint");
    }
    for (;;) {
      const byte = Number(v & 0x7Fn);
      v >>= 7n;
      if (v === 0n) {
        this.chunks.push(byte);
        break;
      }
      this.chunks.push(byte | 0x80);
    }
    return this;
  }

  /** Append a field tag (field number + wire type). */
  tag(fieldNumber: number, wireType: WireTypeValue): this {
    return this.varint((BigInt(fieldNumber) << 3n) | BigInt(wireType));
  }

  /** Write a `varint` field. */
  uint(fieldNumber: number, value: bigint | number): this {
    this.tag(fieldNumber, WireType.Varint);
    return this.varint(value);
  }

  /** Write a `fixed64` field (little-endian). */
  fixed64(fieldNumber: number, value: bigint): this {
    this.tag(fieldNumber, WireType.Fixed64);
    let v = value;
    for (let i = 0; i < 8; i += 1) {
      this.chunks.push(Number(v & 0xFFn));
      v >>= 8n;
    }
    return this;
  }

  /** Write a length-delimited byte field. */
  bytes(fieldNumber: number, value: Uint8Array): this {
    this.tag(fieldNumber, WireType.LengthDelimited);
    this.varint(value.length);
    for (const b of value) this.chunks.push(b);
    return this;
  }

  /** Write a length-delimited UTF-8 string field. */
  string(fieldNumber: number, value: string): this {
    return this.bytes(fieldNumber, new TextEncoder().encode(value));
  }

  /** Write a nested message field (its bytes, length-prefixed). */
  message(fieldNumber: number, build: (w: ProtoWriter) => void): this {
    const inner = new ProtoWriter();
    build(inner);
    return this.bytes(fieldNumber, inner.finish());
  }

  /** Produce the accumulated bytes. */
  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}
