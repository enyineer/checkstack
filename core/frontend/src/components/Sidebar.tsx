import React, { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { pluginRegistry } from "@checkstack/frontend-api";
import { useAccessRules, useManageableTypes } from "@checkstack/auth-frontend";
import { openSearchPalette } from "@checkstack/command-frontend";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import { selectNavGroups } from "./Sidebar.logic";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  cn,
  isNavRouteActive,
  usePerformance,
} from "@checkstack/ui";
import {
  LayoutDashboard,
  ChevronDown,
  ChevronsDownUp,
  BookOpen,
  ExternalLink,
  Search,
} from "lucide-react";

const DOCUMENTATION_GROUP = "Documentation";

/**
 * Fixed display order for the known nav sections. Unknown groups (e.g. from a
 * third-party plugin) are appended after these, alphabetically. The former
 * single "Configuration" group is split into Settings / Platform / Developer
 * so admin, platform, and dev-tooling entries are scannable separately.
 */
const GROUP_ORDER = [
  "Workspace",
  "Reliability",
  "Automation",
  "Settings",
  "Platform",
  "Developer",
  "Documentation",
] as const;

const COLLAPSED_GROUPS_KEY = "checkstack.sidebar.collapsedGroups";

type AppRoute = ReturnType<typeof pluginRegistry.getAllRoutes>[number];
type NavRoute = AppRoute & { nav: NonNullable<AppRoute["nav"]> };

interface NavGroup {
  group: string;
  items: NavRoute[];
  /** Single-entry group rendered flat (no header); see Sidebar.logic. */
  flat: boolean;
}

/** Build the access-filtered, grouped, ordered nav model from the route registry. */
function useNavGroups(): NavGroup[] {
  const { accessRules, isAuthenticated, isInAnyTeam } = useAccessRules();
  // Team-derived capability set: lets management entries (incidents, catalog
  // management, etc.) appear for a team-scoped user who holds no global rule but
  // whose team can create/manage the type. Global-rule users don't need it.
  const { types: manageableTypeList } = useManageableTypes();

  // getAllRoutes() is recomputed from the registry; plugin load/unload triggers
  // an App re-render so this stays current. Cheap O(routes) work.
  const routes = pluginRegistry.getAllRoutes();

  // Pure filtering/grouping (unit-tested in Sidebar.logic.test.ts): access +
  // isVisible gating, with empty groups dropped.
  return useMemo(
    () =>
      selectNavGroups({
        routes,
        accessRules,
        isAuthenticated,
        groupOrder: GROUP_ORDER,
        manageableTypes: new Set(manageableTypeList),
        isInAnyTeam,
      }) as NavGroup[],
    [routes, accessRules, isAuthenticated, manageableTypeList, isInAnyTeam],
  );
}

function loadCollapsedGroups(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((g) => typeof g === "string") : []);
  } catch {
    return new Set();
  }
}

function navItemClass(isActive: boolean): string {
  return cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
  );
}

interface NavLeafProps {
  route: NavRoute;
  pathname: string;
  onNavigate?: () => void;
}

/** A single in-app nav link. Shared by flat groups and grouped sections. */
function NavLeaf({ route, pathname, onNavigate }: NavLeafProps): React.ReactElement {
  const Icon = route.nav.icon;
  const active = isNavRouteActive({ pathname, to: route.path });
  return (
    <NavLink
      to={route.path}
      className={navItemClass(active)}
      onClick={onNavigate}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{route.nav.label}</span>
    </NavLink>
  );
}

interface NavListProps {
  /** Invoked after a nav link is clicked (used to close the mobile drawer). */
  onNavigate?: () => void;
  /**
   * Rendered inside the mobile drawer. Adds an in-drawer search entry and
   * auto-expands the group containing the active route on open.
   */
  mobile?: boolean;
}

/** The shared nav content rendered in both the desktop rail and the mobile drawer. */
function NavList({ onNavigate, mobile = false }: NavListProps): React.ReactElement {
  const { isLowPower } = usePerformance();
  const groups = useNavGroups();
  const location = useLocation();

  // The in-app user guide is a shell-owned external entry (the backend serves
  // the static Astro docs at /checkstack/* same-origin), so it lives under the
  // Documentation group here rather than as a navbar link. Ensure the group
  // renders even when no plugin route contributes to it.
  const groupsToRender = useMemo(
    () =>
      groups.some((g) => g.group === DOCUMENTATION_GROUP)
        ? groups
        : [...groups, { group: DOCUMENTATION_GROUP, items: [], flat: false }],
    [groups],
  );

  // The group whose section root matches the current route, so the mobile
  // drawer can reveal it on open even if the user collapsed it on desktop.
  const activeGroup = useMemo(
    () =>
      groupsToRender.find((g) =>
        g.items.some((route) =>
          isNavRouteActive({ pathname: location.pathname, to: route.path }),
        ),
      )?.group,
    [groupsToRender, location.pathname],
  );

  // The mobile drawer remounts on each open, so seeding the initial collapsed
  // set with the active group removed auto-expands it on open (#01-11) without
  // an effect and without persisting the change to desktop's localStorage.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const persisted = loadCollapsedGroups();
    if (mobile && activeGroup) persisted.delete(activeGroup);
    return persisted;
  });

  const persistCollapsed = (next: Set<string>): void => {
    try {
      globalThis.localStorage?.setItem(
        COLLAPSED_GROUPS_KEY,
        JSON.stringify([...next]),
      );
    } catch {
      // localStorage unavailable (private mode) - in-memory state is enough.
    }
  };

  const toggleGroup = (group: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      persistCollapsed(next);
      return next;
    });
  };

  // Recovery affordance (#01-9): clear every collapsed group at once so a user
  // who collapsed the whole rail is not stuck clicking each header.
  const expandAll = (): void => {
    const empty = new Set<string>();
    persistCollapsed(empty);
    setCollapsed(empty);
  };

  // Only headed (non-flat) groups can be collapsed, so only offer "expand all"
  // when at least one such group is currently collapsed.
  const hasCollapsedGroup = groupsToRender.some(
    (g) => !g.flat && collapsed.has(g.group),
  );

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Primary">
      {/* In-drawer search shortcut (#01-11): opens the same ⌘K palette. */}
      {mobile && (
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            openSearchPalette();
          }}
          className={cn(navItemClass(false), "mb-1")}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Search...</span>
        </button>
      )}

      {/* Dashboard / home is the one entry the shell owns (route "/"). */}
      <NavLink to="/" end className={({ isActive }) => navItemClass(isActive)} onClick={onNavigate}>
        <LayoutDashboard className="h-4 w-4 shrink-0" />
        <span className="truncate">Dashboard</span>
      </NavLink>

      {hasCollapsedGroup && (
        <button
          type="button"
          onClick={expandAll}
          className="mt-1 flex items-center gap-2 self-start px-3 py-1 text-xs font-medium text-muted-foreground/70 hover:text-muted-foreground"
        >
          <ChevronsDownUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Expand all</span>
        </button>
      )}

      {groupsToRender.map(({ group, items, flat }) => {
        const isDocumentation = group === DOCUMENTATION_GROUP;

        // Single-entry groups render flat (no header) to cut chrome (#01-12).
        // The Documentation group keeps its header because it also hosts the
        // external Docs link below its in-app routes.
        if (flat && !isDocumentation) {
          return (
            <div key={group} className="mt-1 flex flex-col gap-0.5">
              {items.map((route) => (
                <NavLeaf
                  key={route.path}
                  route={route}
                  pathname={location.pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          );
        }

        const isCollapsed = collapsed.has(group);
        return (
          <div key={group} className="mt-2">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-muted-foreground"
            >
              <span className="truncate">{group}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  !isLowPower && "transition-transform",
                  isCollapsed && "-rotate-90",
                )}
                aria-hidden="true"
              />
            </button>
            {!isCollapsed && (
              <div className="mt-1 flex flex-col gap-0.5">
                {items.map((route) => (
                  <NavLeaf
                    key={route.path}
                    route={route}
                    pathname={location.pathname}
                    onNavigate={onNavigate}
                  />
                ))}
                {isDocumentation && (
                  <a
                    href={docsPath(APP_DOC_SLUGS.userGuideHome)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the user guide (opens in a new tab)"
                    className={navItemClass(false)}
                    onClick={onNavigate}
                  >
                    <BookOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">Docs</span>
                    {/* External-link marker (#01-8): signals this entry leaves
                        the app, distinguishing it from in-app reference routes. */}
                    <ExternalLink
                      className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                      aria-hidden="true"
                    />
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export interface SidebarProps {
  /** Whether the mobile drawer is open. */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

/**
 * Primary app navigation. A persistent rail on >= md screens; a slide-over
 * drawer (reusing the UI `Sheet`) on small screens, controlled by the navbar
 * hamburger. Nav entries come from routes that declare `nav` metadata and are
 * filtered by the user's access rules.
 */
export function Sidebar({
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps): React.ReactElement {
  return (
    <>
      {/* Fills the shell row (height comes from the flex parent); scrolls
          independently of the main content. */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-surface overflow-y-auto">
        <NavList />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent className="p-0 overflow-y-auto">
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle className="text-base">Navigation</SheetTitle>
          </SheetHeader>
          <NavList mobile onNavigate={() => onMobileOpenChange(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
