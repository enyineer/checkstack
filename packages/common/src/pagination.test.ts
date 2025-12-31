import { describe, it, expect } from "bun:test";
import { PaginationInputSchema, paginatedOutput } from "./pagination";
import { z } from "zod";

describe("PaginationInputSchema", () => {
  it("should accept valid pagination input", () => {
    const result = PaginationInputSchema.parse({
      limit: 20,
      offset: 40,
    });

    expect(result.limit).toBe(20);
    expect(result.offset).toBe(40);
  });

  it("should use default values when not provided", () => {
    const result = PaginationInputSchema.parse({});

    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
  });

  it("should reject limit below 1", () => {
    expect(() => PaginationInputSchema.parse({ limit: 0 })).toThrow();
  });

  it("should reject limit above 100", () => {
    expect(() => PaginationInputSchema.parse({ limit: 101 })).toThrow();
  });

  it("should reject negative offset", () => {
    expect(() => PaginationInputSchema.parse({ offset: -1 })).toThrow();
  });
});

describe("paginatedOutput", () => {
  const ItemSchema = z.object({
    id: z.string(),
    name: z.string(),
  });

  it("should create correct output schema structure", () => {
    const outputSchema = paginatedOutput(ItemSchema);

    const result = outputSchema.parse({
      items: [
        { id: "1", name: "Item 1" },
        { id: "2", name: "Item 2" },
      ],
      total: 100,
    });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(100);
  });

  it("should reject invalid items", () => {
    const outputSchema = paginatedOutput(ItemSchema);

    expect(() =>
      outputSchema.parse({
        items: [{ id: "1" }], // Missing 'name'
        total: 1,
      })
    ).toThrow();
  });

  it("should reject missing total", () => {
    const outputSchema = paginatedOutput(ItemSchema);

    expect(() =>
      outputSchema.parse({
        items: [{ id: "1", name: "Item 1" }],
      })
    ).toThrow();
  });

  it("should accept empty items array", () => {
    const outputSchema = paginatedOutput(ItemSchema);

    const result = outputSchema.parse({
      items: [],
      total: 0,
    });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
