import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { PaginationInput, PaginatedResult } from "./pagination";

describe("PaginationInput (canonical)", () => {
  it("applies default limit and offset when omitted", () => {
    const result = PaginationInput.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("accepts valid limit and offset values", () => {
    const result = PaginationInput.parse({ limit: 50, offset: 100 });
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(100);
  });

  it("rejects limit below 1", () => {
    expect(() => PaginationInput.parse({ limit: 0 })).toThrow();
  });

  it("rejects limit above 100", () => {
    expect(() => PaginationInput.parse({ limit: 101 })).toThrow();
  });

  it("rejects negative offset", () => {
    expect(() => PaginationInput.parse({ offset: -1 })).toThrow();
  });

  it("rejects non-integer limit values", () => {
    expect(() => PaginationInput.parse({ limit: 10.5 })).toThrow();
  });

  it("rejects non-integer offset values", () => {
    expect(() => PaginationInput.parse({ offset: 1.5 })).toThrow();
  });

  it("supports `.extend({...})` for domain extras", () => {
    const ListNotificationsInput = PaginationInput.extend({
      unreadOnly: z.boolean().default(false),
    });

    const parsed = ListNotificationsInput.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.offset).toBe(0);
    expect(parsed.unreadOnly).toBe(false);

    const parsedWithExtras = ListNotificationsInput.parse({
      limit: 5,
      unreadOnly: true,
    });
    expect(parsedWithExtras.limit).toBe(5);
    expect(parsedWithExtras.unreadOnly).toBe(true);
  });

  it("infers a typed PaginationInput", () => {
    const sample: PaginationInput = { limit: 10, offset: 0 };
    expect(sample.limit).toBe(10);
    expect(sample.offset).toBe(0);
  });
});

describe("PaginatedResult (canonical)", () => {
  const ItemSchema = z.object({
    id: z.string(),
    name: z.string(),
  });

  it("produces an { items, total, limit, offset } shape", () => {
    const schema = PaginatedResult(ItemSchema);
    const result = schema.parse({
      items: [
        { id: "1", name: "First" },
        { id: "2", name: "Second" },
      ],
      total: 42,
      limit: 20,
      offset: 0,
    });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(42);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("rejects items that do not match the inner schema", () => {
    const schema = PaginatedResult(ItemSchema);
    expect(() =>
      schema.parse({
        items: [{ id: "1" }],
        total: 1,
        limit: 20,
        offset: 0,
      }),
    ).toThrow();
  });

  it("rejects a missing total", () => {
    const schema = PaginatedResult(ItemSchema);
    expect(() =>
      schema.parse({
        items: [],
        limit: 20,
        offset: 0,
      }),
    ).toThrow();
  });

  it("rejects a missing limit/offset", () => {
    const schema = PaginatedResult(ItemSchema);
    expect(() =>
      schema.parse({
        items: [],
        total: 0,
      }),
    ).toThrow();
  });

  it("rejects a negative total", () => {
    const schema = PaginatedResult(ItemSchema);
    expect(() =>
      schema.parse({
        items: [],
        total: -1,
        limit: 20,
        offset: 0,
      }),
    ).toThrow();
  });

  it("accepts an empty items array", () => {
    const schema = PaginatedResult(ItemSchema);
    const result = schema.parse({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("infers a typed result via z.infer", () => {
    const schema = PaginatedResult(ItemSchema);
    type Result = z.infer<typeof schema>;
    const value: Result = {
      items: [{ id: "x", name: "X" }],
      total: 1,
      limit: 20,
      offset: 0,
    };
    expect(value.items[0]?.id).toBe("x");
  });
});

