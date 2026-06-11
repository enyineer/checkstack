import { describe, test, expect } from "bun:test";
import { selectEvents } from "./select-events";

interface Item {
  id: string;
  resolved: boolean;
  at: string;
}

const NOW = new Date("2026-06-11T00:00:00.000Z").getTime();
const daysAgo = (d: number) =>
  new Date(NOW - d * 86_400_000).toISOString();

const items: Item[] = [
  { id: "a1", resolved: false, at: daysAgo(1) },
  { id: "a2", resolved: false, at: daysAgo(3) },
  { id: "p-recent", resolved: true, at: daysAgo(2) },
  { id: "p-old", resolved: true, at: daysAgo(20) },
];

const base = {
  items,
  isPast: (i: Item) => i.resolved,
  timestampOf: (i: Item) => i.at,
  limit: 5,
  now: NOW,
};

describe("selectEvents", () => {
  test("includePast=false returns only active, newest first", () => {
    const { active, past } = selectEvents({
      ...base,
      includePast: false,
      pastMaxAgeDays: 7,
    });
    expect(active.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(past).toEqual([]);
  });

  test("includePast=true keeps past within the max age, drops older", () => {
    const { active, past } = selectEvents({
      ...base,
      includePast: true,
      pastMaxAgeDays: 7,
    });
    expect(active.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(past.map((i) => i.id)).toEqual(["p-recent"]); // p-old (20d) excluded
  });

  test("a wider max age includes older past items", () => {
    const { past } = selectEvents({
      ...base,
      includePast: true,
      pastMaxAgeDays: 30,
    });
    expect(past.map((i) => i.id)).toEqual(["p-recent", "p-old"]);
  });

  test("limit caps each group independently", () => {
    const many: Item[] = Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`,
      resolved: false,
      at: daysAgo(i),
    }));
    const { active } = selectEvents({
      ...base,
      items: many,
      includePast: false,
      pastMaxAgeDays: 7,
      limit: 3,
    });
    expect(active).toHaveLength(3);
  });
});
