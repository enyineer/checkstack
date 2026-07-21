import { describe, expect, test } from "bun:test";
import type { Group } from "@checkstack/catalog-common";
import { buildCatalogFacets, HEALTH_DISABLED_REASON } from "./catalogFacets.logic";
import { BROWSE_PARAM, UNGROUPED_ID } from "./browseState.logic";

const NOW = new Date("2026-01-01T00:00:00Z");

function makeGroup(id: string, name: string): Group {
  return {
    id,
    name,
    systemIds: [],
    sortOrder: 0,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const groups = [makeGroup("g-payments", "Payments"), makeGroup("g-platform", "Platform")];

function facetById(
  facets: ReturnType<typeof buildCatalogFacets>,
  id: string,
) {
  return facets.find((facet) => facet.id === id);
}

describe("buildCatalogFacets", () => {
  test("facet ids are the browse view's URL parameter names", () => {
    const facets = buildCatalogFacets({
      groups,
      tagOptions: ["team=payments"],
      healthEnabled: true,
    });
    expect(facets.map((facet) => facet.id)).toEqual([
      BROWSE_PARAM.group,
      BROWSE_PARAM.health,
      BROWSE_PARAM.tag,
    ]);
  });

  test("group options are the live groups plus the synthetic ungrouped bucket", () => {
    const group = facetById(
      buildCatalogFacets({ groups, tagOptions: [], healthEnabled: true }),
      BROWSE_PARAM.group,
    );
    expect(group?.options.map((option) => option.value)).toEqual([
      "g-payments",
      "g-platform",
      UNGROUPED_ID,
    ]);
  });

  test("the tag control is omitted when no system carries a tag", () => {
    const facets = buildCatalogFacets({
      groups,
      tagOptions: [],
      healthEnabled: true,
    });
    // An empty dropdown narrows nothing and is pure noise.
    expect(facetById(facets, BROWSE_PARAM.tag)).toBeUndefined();
  });

  test("health is kept but disabled while no health source has reported", () => {
    const facets = buildCatalogFacets({
      groups,
      tagOptions: [],
      healthEnabled: false,
    });
    const health = facetById(facets, BROWSE_PARAM.health);
    // Kept rather than dropped: the control states that the capability exists
    // and what unlocks it, and a health selection on an incoming link survives.
    expect(health?.disabled).toBe(true);
    expect(health?.disabledReason).toBe(HEALTH_DISABLED_REASON);
  });

  test("health is enabled once a source reports", () => {
    const health = facetById(
      buildCatalogFacets({ groups, tagOptions: [], healthEnabled: true }),
      BROWSE_PARAM.health,
    );
    expect(health?.disabled).toBe(false);
    expect(health?.options.map((option) => option.value)).toEqual([
      "healthy",
      "degraded",
      "unhealthy",
      "unknown",
    ]);
  });
});
