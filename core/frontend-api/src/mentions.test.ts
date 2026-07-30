import { afterEach, describe, expect, test } from "bun:test";
import {
  mentionRefKey,
  registerMentionRoutes,
  resolveViewableMentions,
  setMentionResolve,
  setMentionSearch,
} from "./mentions";

/**
 * The registry is process-global by design (a render path must reach it without
 * a hook), so each test clears it to stay independent.
 */
const REGISTRY_KEY = "__checkstack_mention_providers__";
const clearRegistry = () => {
  (globalThis as Record<string, unknown>)[REGISTRY_KEY] = new Map();
};

afterEach(clearRegistry);

const registerType = (type: string) =>
  registerMentionRoutes({
    type,
    displayName: type,
    toRoute: ({ id }) => `/${type}/${id}`,
  });

describe("mentionRefKey", () => {
  test("distinguishes the same id under different types", () => {
    expect(mentionRefKey({ type: "incident", id: "x" })).not.toBe(
      mentionRefKey({ type: "maintenance", id: "x" }),
    );
  });
});

describe("resolveViewableMentions", () => {
  test("returns the ids the provider confirms as readable", async () => {
    registerType("incident");
    setMentionResolve({
      type: "incident",
      resolveRefs: async ({ ids }) => ids.filter((id) => id !== "secret"),
    });

    const viewable = await resolveViewableMentions({
      refs: [
        { type: "incident", id: "i1" },
        { type: "incident", id: "secret" },
      ],
    });

    expect([...viewable]).toEqual(["incident/i1"]);
  });

  test("asks each provider ONCE for all of its ids", async () => {
    // A page referencing twenty incidents must cost one request, not twenty.
    registerType("incident");
    const calls: string[][] = [];
    setMentionResolve({
      type: "incident",
      resolveRefs: async ({ ids }) => {
        calls.push(ids);
        return ids;
      },
    });

    await resolveViewableMentions({
      refs: [
        { type: "incident", id: "a" },
        { type: "incident", id: "b" },
        { type: "incident", id: "c" },
      ],
    });

    expect(calls).toEqual([["a", "b", "c"]]);
  });

  test("de-duplicates ids before asking", async () => {
    registerType("incident");
    const calls: string[][] = [];
    setMentionResolve({
      type: "incident",
      resolveRefs: async ({ ids }) => {
        calls.push(ids);
        return ids;
      },
    });

    await resolveViewableMentions({
      refs: [
        { type: "incident", id: "a" },
        { type: "incident", id: "a" },
      ],
    });

    expect(calls).toEqual([["a"]]);
  });

  test("routes each type to its OWN provider", async () => {
    registerType("incident");
    registerType("maintenance");
    setMentionResolve({
      type: "incident",
      resolveRefs: async ({ ids }) => ids,
    });
    setMentionResolve({
      type: "maintenance",
      resolveRefs: async () => [],
    });

    const viewable = await resolveViewableMentions({
      refs: [
        { type: "incident", id: "x" },
        { type: "maintenance", id: "x" },
      ],
    });

    expect([...viewable]).toEqual(["incident/x"]);
  });

  test("fails CLOSED for a provider that throws", async () => {
    // One plugin's outage must not silently grant links to its records.
    registerType("incident");
    setMentionResolve({
      type: "incident",
      resolveRefs: async () => {
        throw new Error("backend down");
      },
    });

    const viewable = await resolveViewableMentions({
      refs: [{ type: "incident", id: "i1" }],
    });

    expect(viewable.size).toBe(0);
  });

  test("one provider throwing does not withhold ANOTHER provider's links", async () => {
    registerType("incident");
    registerType("maintenance");
    setMentionResolve({
      type: "incident",
      resolveRefs: async () => {
        throw new Error("down");
      },
    });
    setMentionResolve({
      type: "maintenance",
      resolveRefs: async ({ ids }) => ids,
    });

    const viewable = await resolveViewableMentions({
      refs: [
        { type: "incident", id: "i1" },
        { type: "maintenance", id: "m1" },
      ],
    });

    expect([...viewable]).toEqual(["maintenance/m1"]);
  });

  test("fails CLOSED for a registered provider with no resolveRefs", async () => {
    registerType("incident");

    const viewable = await resolveViewableMentions({
      refs: [{ type: "incident", id: "i1" }],
    });

    expect(viewable.size).toBe(0);
  });

  test("fails CLOSED for an unregistered type", async () => {
    const viewable = await resolveViewableMentions({
      refs: [{ type: "never-installed", id: "x" }],
    });

    expect(viewable.size).toBe(0);
  });

  test("no refs resolves to nothing without asking any provider", async () => {
    registerType("incident");
    let asked = false;
    setMentionResolve({
      type: "incident",
      resolveRefs: async ({ ids }) => {
        asked = true;
        return ids;
      },
    });

    const viewable = await resolveViewableMentions({ refs: [] });

    expect(viewable.size).toBe(0);
    expect(asked).toBe(false);
  });
});

describe("registry half-installation", () => {
  test("re-registering routes PRESERVES an installed resolveRefs", async () => {
    // A plugin reloaded at runtime re-runs its module-scope route
    // registration. Dropping the React-installed half there would silently
    // downgrade every one of its mentions to plain text.
    registerType("incident");
    setMentionResolve({
      type: "incident",
      resolveRefs: async ({ ids }) => ids,
    });

    registerType("incident");

    const viewable = await resolveViewableMentions({
      refs: [{ type: "incident", id: "i1" }],
    });
    expect([...viewable]).toEqual(["incident/i1"]);
  });

  test("installing search does not clobber resolveRefs", async () => {
    registerType("incident");
    setMentionResolve({
      type: "incident",
      resolveRefs: async ({ ids }) => ids,
    });
    setMentionSearch({ type: "incident", search: async () => [] });

    const viewable = await resolveViewableMentions({
      refs: [{ type: "incident", id: "i1" }],
    });
    expect([...viewable]).toEqual(["incident/i1"]);
  });

  test("installing resolveRefs for an unregistered type is a no-op", async () => {
    setMentionResolve({ type: "ghost", resolveRefs: async ({ ids }) => ids });

    const viewable = await resolveViewableMentions({
      refs: [{ type: "ghost", id: "x" }],
    });
    expect(viewable.size).toBe(0);
  });
});
