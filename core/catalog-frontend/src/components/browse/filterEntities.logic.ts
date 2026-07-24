import type {
  System,
  Group,
  Environment,
  CatalogHealthStatuses,
} from "@checkstack/catalog-common";
import {
  hasCatalogFilters,
  type BrowseState,
  type CatalogFilters,
  type Density,
  UNGROUPED_ID,
} from "./browseState.logic";
import { normalizeMetadata } from "../../utils/normalizeMetadata.logic";
import {
  computeGroupRollup,
  matchesHealth,
  type GroupHealthRollup,
} from "./healthRollup.logic";

/**
 * Pure, DOM-free grouping + filtering logic for the catalog browse view.
 *
 * Filtering is client-side over the already-loaded `getEntities` set (systems
 * and groups), matching the command palette's server-side `includes` matching
 * but reproduced on the client at operator scale (thousands of rows, not
 * millions — see the plan §5). No new backend endpoint is needed.
 */

/** A system together with the metadata-derived filter tokens it exposes. */
export interface SystemView {
  system: System;
  /** `"key=value"` and `"key"` tokens for string-valued metadata entries. */
  tags: string[];
}

/** One rendered group section: the group (or synthetic Ungrouped) + members. */
export interface GroupSection {
  /** Group id, or `UNGROUPED_ID` for the synthetic ungrouped section. */
  id: string;
  /** Display name. */
  name: string;
  /** `true` for the synthetic "Ungrouped" section. */
  isUngrouped: boolean;
  /** Member systems that survived filtering, in input order. */
  systems: System[];
  /** Total member count BEFORE filtering (the header count). */
  totalCount: number;
  /** Whether this section is open given URL overrides + default policy. */
  open: boolean;
  /**
   * Health rollup for the header, derived from ALL members (pre-filter) and the
   * reported status map — NOT from the filtered rows or rendered badges. When no
   * health source filled the slot, `rollup.hasData` is `false` and the header
   * shows counts only.
   */
  rollup: GroupHealthRollup;
}

/** The fully-derived browse model the page renders. */
export interface BrowseModel {
  sections: GroupSection[];
  /** `true` when every section is empty after filtering (filtered-to-empty). */
  isFilteredEmpty: boolean;
  /** `true` when the catalog has no systems and no groups at all. */
  isEmptyCatalog: boolean;
  density: Density;
}

/** Case-insensitive substring match, null-safe. */
function matchesText(haystack: string | null | undefined, needle: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Derive the metadata filter tokens for a system. Only string-valued entries
 * are surfaced (matching the plan §3.2 / §4.3 metadata rendering), each as
 * both a bare `"key"` token and a `"key=value"` token so a tag filter can
 * match either form.
 */
export function systemTags(system: System): string[] {
  const entries = normalizeMetadata(system.metadata);
  const tags: string[] = [];
  for (const { key, displayValue } of entries) {
    tags.push(key);
    if (displayValue.length > 0) tags.push(`${key}=${displayValue}`);
  }
  return tags;
}

/**
 * Collect the distinct `key=value` tag tokens across a set of systems, sorted
 * for stable rendering. Used to populate the browse "Tags" filter dropdown.
 * Only `key=value` form is offered (the bare-key tokens are matching aliases).
 */
export function collectTagOptions(systems: System[]): string[] {
  const seen = new Set<string>();
  for (const system of systems) {
    for (const tag of systemTags(system)) {
      if (tag.includes("=")) seen.add(tag);
    }
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Does a named entity pass the search-query filter (name OR description)?
 *
 * Deliberately structural rather than `System`-typed: systems, environments and
 * groups are all searched by the SAME box, so they must agree on what "matches"
 * means. A group carries no description, which the optional field covers.
 */
export function matchesQuery(
  entity: { name: string; description?: string | null },
  query: string,
): boolean {
  if (!query) return true;
  return (
    matchesText(entity.name, query) || matchesText(entity.description, query)
  );
}

/** Does a system pass the tag filter? */
export function matchesTag(system: System, tag: string | null): boolean {
  if (!tag) return true;
  const lower = tag.toLowerCase();
  return systemTags(system).some((t) => t.toLowerCase() === lower);
}

/**
 * Build the grouped, filtered browse model.
 *
 * - Groups partition systems by membership; a system in N groups appears under
 *   each (matches the management many-to-many model). A synthetic "Ungrouped"
 *   section collects systems in no group.
 * - The `group` filter narrows to a single group section (the synthetic
 *   ungrouped section is selectable via `UNGROUPED_ID`).
 * - Search + tag + health filters compose (AND) and apply per-system. The health
 *   filter reads the reported `statuses` map (Phase 4); when the slot is unfilled
 *   every system is `"unknown"`.
 * - A query causes groups with zero surviving members to drop out entirely,
 *   and forces matching groups open (search auto-expand) unless the URL state
 *   explicitly forced them closed.
 * - Default-open policy (no query): all-healthy groups (derived from the status
 *   DATA, not badges) start collapsed so attention goes to what needs it; any
 *   group with a non-healthy or unknown member starts expanded. With no health
 *   data at all (slot unfilled) every group starts expanded. The URL `open` state
 *   always overrides the computed default.
 */
export function buildBrowseModel({
  systems,
  groups,
  state,
  statuses,
}: {
  systems: System[];
  groups: Group[];
  state: BrowseState;
  /**
   * Per-system health from the `CatalogBrowseHealthSlot` filler, or undefined
   * when no health source is installed (group rollups show counts only and the
   * health filter resolves everything to `"unknown"`).
   */
  statuses?: CatalogHealthStatuses;
}): BrowseModel {
  const isEmptyCatalog = systems.length === 0 && groups.length === 0;

  const passesSystemFilters = (system: System): boolean =>
    matchesQuery(system, state.query) &&
    matchesTag(system, state.tag) &&
    matchesHealth({ systemId: system.id, health: state.health, statuses });

  const systemById = new Map<string, System>();
  for (const system of systems) systemById.set(system.id, system);

  const hasQuery = state.query.trim().length > 0;

  const resolveOpen = ({
    id,
    hasMatch,
    allHealthy,
  }: {
    id: string;
    hasMatch: boolean;
    allHealthy: boolean;
  }): boolean => {
    const override = state.open[id];
    if (override !== undefined) return override;
    // Search auto-expands any group with a surviving match.
    if (hasQuery && hasMatch) return true;
    // Default policy: all-healthy groups (derived from health DATA) start
    // collapsed so attention goes to what needs it; everything else (degraded,
    // unhealthy, unknown, or no health data) starts expanded.
    return !allHealthy;
  };

  const sections: GroupSection[] = [];

  // Real group sections.
  const groupedSystemIds = new Set<string>();
  for (const group of groups) {
    const memberIds = group.systemIds ?? [];
    for (const id of memberIds) groupedSystemIds.add(id);

    // A group filter hides every other group section.
    if (state.group && state.group !== group.id) continue;

    const members = memberIds
      .map((id) => systemById.get(id))
      .filter((s): s is System => s !== undefined);

    const filtered = members.filter((s) => passesSystemFilters(s));

    // Under an active query, drop groups with no surviving member.
    if (hasQuery && filtered.length === 0) continue;

    // Rollup is over ALL members (pre-filter), from the status DATA.
    const rollup = computeGroupRollup({
      memberIds: members.map((s) => s.id),
      statuses,
    });

    sections.push({
      id: group.id,
      name: group.name,
      isUngrouped: false,
      systems: filtered,
      totalCount: members.length,
      open: resolveOpen({
        id: group.id,
        hasMatch: filtered.length > 0,
        allHealthy: rollup.allHealthy,
      }),
      rollup,
    });
  }

  // Synthetic Ungrouped section: systems belonging to no group.
  const showUngrouped = !state.group || state.group === UNGROUPED_ID;
  if (showUngrouped) {
    const ungroupedMembers = systems.filter((s) => !groupedSystemIds.has(s.id));
    const filtered = ungroupedMembers.filter((s) => passesSystemFilters(s));
    const include = ungroupedMembers.length > 0 && !(hasQuery && filtered.length === 0);
    if (include) {
      const rollup = computeGroupRollup({
        memberIds: ungroupedMembers.map((s) => s.id),
        statuses,
      });
      sections.push({
        id: UNGROUPED_ID,
        name: "Ungrouped",
        isUngrouped: true,
        systems: filtered,
        totalCount: ungroupedMembers.length,
        open: resolveOpen({
          id: UNGROUPED_ID,
          hasMatch: filtered.length > 0,
          allHealthy: rollup.allHealthy,
        }),
        rollup,
      });
    }
  }

  const hasAnyFilter = hasCatalogFilters(state);
  const isFilteredEmpty =
    !isEmptyCatalog &&
    hasAnyFilter &&
    sections.every((section) => section.systems.length === 0);

  return {
    sections,
    isFilteredEmpty,
    isEmptyCatalog,
    density: state.density,
  };
}

/** The filtered flat lists the management page renders. */
export interface ManagementListsModel {
  /** Systems surviving the search/tag/group/health filters, in input order. */
  systems: System[];
  /** Groups surviving the search/group filters, in input order. */
  groups: Group[];
  /** `true` when the catalog has no systems and no groups at all. */
  isEmptyCatalog: boolean;
}

/**
 * Filter the management page's two flat lists (systems + groups) using the SAME
 * search/tag/group/health state and the SAME per-system matchers as the browse
 * model — so browse and manage share one filter implementation (plan §2.2). The
 * management page renders flat draggable/droppable lists rather than collapsible
 * sections, so this returns plain arrays instead of a `BrowseModel`.
 *
 * Semantics:
 * - **Systems**: pass query+tag, and (no group filter) OR belong to the selected
 *   group (or are ungrouped when the synthetic `UNGROUPED_ID` is selected).
 * - **Groups**: pass the group filter (id match, or none / `UNGROUPED_ID` shows
 *   no real group), and under an active query are kept when the group name
 *   matches OR the group contains a system that matches query+tag+health.
 * - The health filter reads the reported `statuses` map (Phase 4); when the slot
 *   is unfilled every system is `"unknown"`, so only an unconstrained or
 *   `"unknown"` selection matches anything.
 */
export function filterManagementLists({
  systems,
  groups,
  state,
  statuses,
}: {
  systems: System[];
  groups: Group[];
  state: BrowseState;
  /** Per-system health from the slot filler, or undefined when unfilled. */
  statuses?: CatalogHealthStatuses;
}): ManagementListsModel {
  const isEmptyCatalog = systems.length === 0 && groups.length === 0;
  const hasQuery = state.query.trim().length > 0;

  const passesSystemFilters = (system: System): boolean =>
    matchesQuery(system, state.query) &&
    matchesTag(system, state.tag) &&
    matchesHealth({ systemId: system.id, health: state.health, statuses });

  // Map each group id to the set of member ids for membership checks.
  const groupById = new Map<string, Group>();
  for (const group of groups) groupById.set(group.id, group);

  const groupedSystemIds = new Set<string>();
  for (const group of groups) {
    for (const id of group.systemIds ?? []) groupedSystemIds.add(id);
  }

  const inSelectedGroup = (system: System): boolean => {
    if (!state.group) return true;
    if (state.group === UNGROUPED_ID) return !groupedSystemIds.has(system.id);
    return (groupById.get(state.group)?.systemIds ?? []).includes(system.id);
  };

  const filteredSystems = systems.filter(
    (system) => passesSystemFilters(system) && inSelectedGroup(system),
  );

  const groupContainsMatch = (group: Group): boolean =>
    (group.systemIds ?? [])
      .map((id) => systems.find((s) => s.id === id))
      .filter((s): s is System => s !== undefined)
      .some((s) => passesSystemFilters(s));

  const filteredGroups = groups.filter((group) => {
    // The synthetic "Ungrouped" selection hides every real group.
    if (state.group === UNGROUPED_ID) return false;
    if (state.group && state.group !== group.id) return false;
    if (!hasQuery) return true;
    return matchesQuery(group, state.query) || groupContainsMatch(group);
  });

  return {
    systems: filteredSystems,
    groups: filteredGroups,
    isEmptyCatalog,
  };
}

/**
 * Filter the management page's Environments tab with the SAME search rule the
 * systems list uses (name OR description), so one search box behaves the same
 * on every tab.
 *
 * Environments are deliberately untouched by the group/health/tag facets: an
 * environment has no group membership, no health, and its metadata is template
 * input for the systems attached to it rather than a filter token. Narrowing by
 * a dimension the entity does not have would empty the tab for no stated reason.
 */
export function filterEnvironments({
  environments,
  filters,
}: {
  environments: Environment[];
  filters: CatalogFilters;
}): Environment[] {
  if (filters.query.trim().length === 0) return environments;
  return environments.filter((environment) =>
    matchesQuery(environment, filters.query),
  );
}
