import React, { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { pluginRegistry } from "@checkstack/frontend-api";
import { useAccessRules } from "@checkstack/auth-frontend";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import { selectNavGroups } from "./Sidebar.logic";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  cn,
  usePerformance,
} from "@checkstack/ui";
import { LayoutDashboard, ChevronDown, BookOpen } from "lucide-react";

const DOCUMENTATION_GROUP = "Documentation";

/**
 * Fixed display order for the known nav sections. Unknown groups (e.g. from a
 * third-party plugin) are appended after these, alphabetically.
 */
const GROUP_ORDER = [
  "Workspace",
  "Reliability",
  "Automation",
  "Configuration",
  "Documentation",
] as const;

const COLLAPSED_GROUPS_KEY = "checkstack.sidebar.collapsedGroups";

type AppRoute = ReturnType<typeof pluginRegistry.getAllRoutes>[number];
type NavRoute = AppRoute & { nav: NonNullable<AppRoute["nav"]> };

interface NavGroup {
  group: string;
  items: NavRoute[];
}

/** Build the access-filtered, grouped, ordered nav model from the route registry. */
function useNavGroups(): NavGroup[] {
  const { accessRules, isAuthenticated } = useAccessRules();

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
      }) as NavGroup[],
    [routes, accessRules, isAuthenticated],
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
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

interface NavListProps {
  /** Invoked after a nav link is clicked (used to close the mobile drawer). */
  onNavigate?: () => void;
}

/** The shared nav content rendered in both the desktop rail and the mobile drawer. */
function NavList({ onNavigate }: NavListProps): React.ReactElement {
  const { isLowPower } = usePerformance();
  const groups = useNavGroups();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedGroups);

  // The in-app user guide is a shell-owned external entry (the backend serves
  // the static Astro docs at /checkstack/* same-origin), so it lives under the
  // Documentation group here rather than as a navbar link. Ensure the group
  // renders even when no plugin route contributes to it.
  const groupsToRender = useMemo(
    () =>
      groups.some((g) => g.group === DOCUMENTATION_GROUP)
        ? groups
        : [...groups, { group: DOCUMENTATION_GROUP, items: [] }],
    [groups],
  );

  const toggleGroup = (group: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      try {
        globalThis.localStorage?.setItem(
          COLLAPSED_GROUPS_KEY,
          JSON.stringify([...next]),
        );
      } catch {
        // localStorage unavailable (private mode) - in-memory state is enough.
      }
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Primary">
      {/* Dashboard / home is the one entry the shell owns (route "/"). */}
      <NavLink to="/" end className={({ isActive }) => navItemClass(isActive)} onClick={onNavigate}>
        <LayoutDashboard className="h-4 w-4 shrink-0" />
        <span className="truncate">Dashboard</span>
      </NavLink>

      {groupsToRender.map(({ group, items }) => {
        const isCollapsed = collapsed.has(group);
        const isDocumentation = group === DOCUMENTATION_GROUP;
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
                {items.map((route) => {
                  const Icon = route.nav.icon;
                  const active =
                    location.pathname === route.path ||
                    location.pathname.startsWith(`${route.path}/`);
                  return (
                    <NavLink
                      key={route.path}
                      to={route.path}
                      className={navItemClass(active)}
                      onClick={onNavigate}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{route.nav.label}</span>
                    </NavLink>
                  );
                })}
                {isDocumentation && (
                  <a
                    href={docsPath(APP_DOC_SLUGS.userGuideHome)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the user guide"
                    className={navItemClass(false)}
                    onClick={onNavigate}
                  >
                    <BookOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate">Docs</span>
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
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border overflow-y-auto">
        <NavList />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent className="p-0 overflow-y-auto">
          <SheetHeader className="px-4 py-3 border-b border-border">
            <SheetTitle className="text-base">Navigation</SheetTitle>
          </SheetHeader>
          <NavList onNavigate={() => onMobileOpenChange(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
