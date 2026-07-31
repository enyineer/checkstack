import { describe, expect, it } from "bun:test";
import type { MentionSuggestion } from "./mentions";
import {
  MAX_MENTION_RESULTS,
  filterMentionCandidates,
} from "./mention-search.logic";

/**
 * Ranking for the `#` mention picker.
 *
 * The behaviour that matters most here is ACTIVE-FIRST. Closed records used to
 * be excluded from the picker entirely, so referencing a resolved incident from
 * a follow-up was impossible to author even though such a reference renders
 * fine. Including them creates the opposite risk - finished records accumulate
 * without bound, so left unordered they would eventually bury every live one
 * behind the result cap. The ordering is what makes inclusion safe, which is
 * why it is pinned here rather than left to the callers.
 */

const suggestion = (
  label: string,
  isActive?: boolean,
): MentionSuggestion => ({
  id: label.toLowerCase().replaceAll(" ", "-"),
  label,
  ...(isActive === undefined ? {} : { isActive }),
});

const labels = (results: MentionSuggestion[]) => results.map((r) => r.label);

describe("filterMentionCandidates", () => {
  it("offers closed records - they are ranked, not removed", () => {
    // The whole point of the change: a finished window must remain mentionable.
    const results = filterMentionCandidates({
      candidates: [suggestion("Database upgrade", false)],
      query: "database",
    });

    expect(labels(results)).toEqual(["Database upgrade"]);
  });

  it("sorts every closed record behind every active one", () => {
    const results = filterMentionCandidates({
      candidates: [
        suggestion("Alpha done", false),
        suggestion("Zulu live", true),
        suggestion("Bravo done", false),
        suggestion("Yankee live", true),
      ],
      query: "",
    });

    expect(labels(results)).toEqual([
      "Zulu live",
      "Yankee live",
      "Alpha done",
      "Bravo done",
    ]);
  });

  it("keeps a closed record behind an active one even when it matches BETTER", () => {
    // Active-first deliberately outranks relevance: "Database upgrade" is a
    // prefix match and would otherwise win, but it is finished.
    const results = filterMentionCandidates({
      candidates: [
        suggestion("Database upgrade", false),
        suggestion("Failover for database", true),
      ],
      query: "database",
    });

    expect(labels(results)).toEqual([
      "Failover for database",
      "Database upgrade",
    ]);
  });

  it("treats a missing isActive as ACTIVE", () => {
    // A provider with no lifecycle must not be demoted below another type's
    // live records just because it says nothing about activity.
    const results = filterMentionCandidates({
      candidates: [suggestion("Closed thing", false), suggestion("Unknown")],
      query: "",
    });

    expect(labels(results)).toEqual(["Unknown", "Closed thing"]);
  });

  it("ranks prefix matches ahead of mid-word ones WITHIN the active group", () => {
    const results = filterMentionCandidates({
      candidates: [
        suggestion("Restore database", true),
        suggestion("Database upgrade", true),
      ],
      query: "data",
    });

    expect(labels(results)).toEqual(["Database upgrade", "Restore database"]);
  });

  it("preserves the caller's order for an empty query", () => {
    // The API returns these most-recent-first. Alphabetising the "just pressed
    // #" list would bury the window scheduled a minute ago under older ones.
    const results = filterMentionCandidates({
      candidates: [
        suggestion("Zulu", true),
        suggestion("Alpha", true),
        suggestion("Mike", true),
      ],
      query: "",
    });

    expect(labels(results)).toEqual(["Zulu", "Alpha", "Mike"]);
  });

  it("matches case-insensitively on any part of the title", () => {
    const results = filterMentionCandidates({
      candidates: [
        suggestion("Checkout DEGRADED", true),
        suggestion("Unrelated", true),
      ],
      query: "degraded",
    });

    expect(labels(results)).toEqual(["Checkout DEGRADED"]);
  });

  it("caps the list, and the cap keeps the ACTIVE records", () => {
    // The failure mode inclusion could have introduced: closed records filling
    // the list and pushing live ones off the end.
    const closed = Array.from({ length: 20 }, (_, i) =>
      suggestion(`Closed ${i}`, false),
    );
    const active = [suggestion("Live one", true), suggestion("Live two", true)];

    const results = filterMentionCandidates({
      candidates: [...closed, ...active],
      query: "",
    });

    expect(results).toHaveLength(MAX_MENTION_RESULTS);
    expect(labels(results).slice(0, 2)).toEqual(["Live one", "Live two"]);
  });

  it("honours an explicit limit", () => {
    const results = filterMentionCandidates({
      candidates: [suggestion("A", true), suggestion("B", true)],
      query: "",
      limit: 1,
    });

    expect(results).toHaveLength(1);
  });

  it("returns nothing when no title matches", () => {
    const results = filterMentionCandidates({
      candidates: [suggestion("Database upgrade", true)],
      query: "kubernetes",
    });

    expect(results).toEqual([]);
  });

  it("does not mutate the candidates it is given", () => {
    // Callers hold this array across renders (it is built once from a query
    // result), so an in-place sort would reorder their state as a side effect.
    const candidates = [suggestion("Beta", false), suggestion("Alpha", true)];
    const before = labels(candidates);

    filterMentionCandidates({ candidates, query: "a" });

    expect(labels(candidates)).toEqual(before);
  });
});
