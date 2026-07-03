import type { Page } from "@playwright/test";
import type { SeedRefs } from "../seed/types.ts";
import { AI_CHAT_TITLE } from "../seed/ai-chat.ts";

/**
 * One screenshot: where to go, what to do once there, and how to frame it.
 *
 * `route` is app-relative (the browser context carries the baseURL). Detail
 * routes are built from {@link SeedRefs} so they point at the richest seeded
 * example. `preActions` open drawers / switch tabs / trigger overlays before
 * the frame. `clipSelector` shoots a single element; otherwise the fixed
 * viewport is captured (or the full page when `fullPage`).
 */
export interface Shot {
  name: string;
  route: string;
  preActions?: (page: Page) => Promise<void>;
  clipSelector?: string;
  fullPage?: boolean;
  settleMs?: number;
}

/**
 * Click a tab by its (case-insensitive, partial) accessible name. Tabs render
 * inconsistently (role=tab, or a plain button/link), so we try each in turn
 * with a short timeout and never fail the shot if none matches.
 */
function clickTab(name: RegExp): (page: Page) => Promise<void> {
  return async (page) => {
    for (const role of ["tab", "button", "link"] as const) {
      const target = page.getByRole(role, { name }).first();
      try {
        await target.click({ timeout: 4000 });
        await page.waitForTimeout(400);
        return;
      } catch {
        // try the next role
      }
    }
  };
}

/** Dismiss any open tip banners (e.g. the dashboard welcome card). */
async function dismissTips(page: Page): Promise<void> {
  const buttons = page.getByRole("button", { name: /dismiss tip/i });
  for (let i = (await buttons.count()) - 1; i >= 0; i--) {
    await buttons.nth(i).click().catch(() => {});
  }
  await page.waitForTimeout(300);
}

/**
 * Expand every collapsed catalog group. Groups collapse when all their members
 * are healthy. Each group header is a button whose accessible name ends in
 * "N systems"; we scope to those (a bare `aria-expanded` selector also matches
 * the Help / bell / filter controls and would pop those open instead), and
 * click each one that is still collapsed exactly once.
 */
async function expandCatalogGroups(page: Page): Promise<void> {
  const headers = page.getByRole("button", { name: /\d+\s+systems?$/i });
  const count = await headers.count();
  for (let i = 0; i < count; i++) {
    const header = headers.nth(i);
    if ((await header.getAttribute("aria-expanded")) === "false") {
      await header.click().catch(() => {});
      await page.waitForTimeout(120);
    }
  }
}

/**
 * Open the collector config in the health-check IDE. The editor is a tree +
 * panel (no tabs): clicking the collector's tree node swaps the right panel to
 * its Configuration + Assertions form. The node label is the raw collector id
 * until the async collectors query resolves, then becomes "HTTP Request" - so
 * waiting for that human label guarantees the panel will populate (a click
 * before it resolves leaves an empty pane).
 */
async function openCollectorConfig(page: Page): Promise<void> {
  const node = page.getByRole("button", { name: "HTTP Request", exact: true });
  await node.waitFor({ timeout: 10_000 }).catch(() => {});
  await node.click().catch(() => {});
  await page
    .getByText("Configuration", { exact: false })
    .first()
    .waitFor({ timeout: 6000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * The curated marketing/README screenshot set. Grouped by product area; each
 * name is the output filename stem. Kept intentionally comprehensive - every
 * major surface plus the newer ones that have no screenshot today (AI chat,
 * automations, script sandbox, health-check run history + chart drawer).
 */
export function buildShots(refs: SeedRefs): Shot[] {
  return [
    // ── Overview ──────────────────────────────────────────────────────────
    { name: "dashboard", route: "/", preActions: dismissTips },
    { name: "catalog-overview", route: "/catalog/", preActions: expandCatalogGroups },
    { name: "system-detail", route: `/catalog/system/${refs.systemId}` },

    // ── Health checks ─────────────────────────────────────────────────────
    { name: "healthcheck-strategies", route: "/healthcheck/config/create" },
    {
      name: "healthcheck-ide",
      route: `/healthcheck/config/${refs.configurationId}/edit`,
      // Open the collector's Configuration + Assertions view (more meaningful
      // than the default General node).
      preActions: openCollectorConfig,
      settleMs: 1500,
    },
    { name: "healthcheck-config", route: "/healthcheck/config" },
    {
      name: "healthcheck-run-history",
      // Deep-link a selected run (trailing path segment) so the master-detail
      // shows the run's charts on the right instead of the empty placeholder.
      route: `/healthcheck/history/${refs.systemId}/${refs.configurationId}/${refs.historyRunId}`,
      preActions: async (page) => {
        await page
          .getByRole("tab", { name: /chart/i })
          .first()
          .waitFor({ timeout: 6000 })
          .catch(() => {});
      },
      settleMs: 1800,
    },
    {
      name: "healthcheck-drawer",
      route: `/catalog/system/${refs.systemId}`,
      // Open the health-check detail slide-over (the chart kit) by clicking the
      // flagship check card, which calls onSelect to mount the drawer.
      preActions: async (page) => {
        await page
          .getByText("Checkout API health", { exact: false })
          .first()
          .click()
          .catch(() => {});
        await page.waitForTimeout(1600);
      },
      settleMs: 1600,
    },

    // ── SLO ───────────────────────────────────────────────────────────────
    { name: "slo-dashboard", route: "/slo/", settleMs: 1200 },
    { name: "slo-detail", route: `/slo/${refs.sloId}`, settleMs: 1200 },
    { name: "slo-editor", route: "/slo/config" },

    // ── Dependencies ──────────────────────────────────────────────────────
    {
      name: "dependency-map",
      route: "/dependency/map",
      // Positions are seeded (see scenario NODE_POSITIONS); click Fit to
      // center/zoom the layered graph before the frame.
      preActions: async (page) => {
        await page
          .getByRole("button", { name: "Fit", exact: true })
          .click({ timeout: 4000 })
          .catch(() => {});
        await page.waitForTimeout(700);
      },
      settleMs: 1800,
    },

    // ── Incidents & maintenance ───────────────────────────────────────────
    { name: "incidents", route: "/incident/config" },
    { name: "incident-detail", route: `/incident/${refs.incidentId}` },
    { name: "maintenance", route: "/maintenance/config" },
    {
      name: "maintenance-detail",
      route: `/maintenance/${refs.maintenanceId}`,
    },

    // ── AI & automation (currently un-screenshotted marketing features) ────
    // The AI chat is seeded with a fake conversation (see seed/ai-chat.ts) so it
    // shows a real transcript rather than the empty "not configured" state. The
    // page opens on the sidebar list (no deep-link URL for a conversation), so we
    // click the seeded conversation row to load its transcript before the frame.
    {
      name: "ai-chat",
      route: "/ai/chat",
      preActions: async (page) => {
        await page
          .getByText(AI_CHAT_TITLE, { exact: false })
          .first()
          .click()
          .catch(() => {});
        await page.waitForTimeout(1000);
      },
      settleMs: 1200,
    },
    { name: "automations", route: "/automation/" },

    // ── Notifications & integrations ──────────────────────────────────────
    // The in-app feed is seeded with a populated inbox (see
    // seed/notifications-inbox.ts) so it shows real cards, not the empty state.
    { name: "notification-overview", route: "/notification/", settleMs: 1000 },
    { name: "notification-settings", route: "/notification/settings" },
    { name: "integrations", route: "/integration/" },

    // ── GitOps ────────────────────────────────────────────────────────────
    // Providers/Sync-Status need a REAL reachable Git repo to look clean (a demo
    // repo yields a sync-error / empty state), so we show the two repo-independent
    // surfaces: the secrets store and the always-populated kind registry.
    {
      name: "gitops-secrets",
      route: "/gitops/",
      preActions: clickTab(/secret/i),
    },
    { name: "gitops-kinds", route: "/gitops/kinds" },

    // ── Satellites ────────────────────────────────────────────────────────
    { name: "satellites", route: "/satellite/" },

    // ── Access control & admin ────────────────────────────────────────────
    {
      name: "auth-roles",
      route: "/auth/settings",
      preActions: clickTab(/role|access/i),
    },
    { name: "auth-teams", route: "/auth/teams" },
    {
      name: "auth-strategies",
      route: "/auth/settings",
      preActions: clickTab(/strateg/i),
    },
    {
      name: "auth-applications",
      route: "/auth/settings",
      preActions: clickTab(/application/i),
    },
    { name: "profile", route: "/auth/profile" },

    // ── Platform & developer ──────────────────────────────────────────────
    { name: "api-docs", route: "/api-docs/", settleMs: 1200 },
    {
      name: "queue-config",
      route: "/infrastructure/config",
      preActions: clickTab(/queue/i),
    },
    { name: "script-sandbox", route: "/script-packages/sandbox" },
    { name: "announcements", route: "/announcement/manage" },
    {
      name: "command-palette",
      route: "/",
      preActions: async (page) => {
        await page.keyboard.press("Meta+k");
        await page.waitForTimeout(500);
        await page.keyboard.type("health");
        await page.waitForTimeout(400);
      },
    },
  ];
}
