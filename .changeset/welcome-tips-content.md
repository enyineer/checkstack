---
"@checkstack/dashboard-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/notification-frontend": minor
"@checkstack/integration-frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/slo-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/satellite-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/pluginmanager-frontend": minor
"@checkstack/announcement-frontend": minor
---

Wire the new tips infrastructure across the frontends:

**Empty-state coaching.** Replace generic "no items" copy with onboarding
guidance — short description, three numbered steps and a primary CTA — on
every EmptyState that has a meaningful next action. Affects: catalog
(systems + groups), dashboard, health-check page, integrations (subscriptions
+ provider connections), GitOps providers + secrets, GitOps provenance,
SLO config + overview, maintenance config, satellites, plugin manager,
incident config, announcements. Read-only EmptyStates (incident history,
maintenance history, plugin events) get clearer descriptions explaining
what would populate them.

**First-run anchored tips.** Add `<Tip>` popovers to the most important
"Create" affordances so first-time users see a one-line explanation of
what they're about to make and why it matters: catalog “Add System” /
“Add Group”, healthcheck “Create Check”, integrations “New Subscription”,
GitOps “Add Provider”, SLO “Create SLO”, maintenance “Create Maintenance”,
satellite “Create Satellite”, plugin-manager “Install plugin”, incident
“Report Incident”, announcement “New Announcement”. Each tip is dismissed
per user (server-backed when signed in, localStorage otherwise) and
namespaced through `qualifyTipId(plugin, …)` so it cannot escape the
plugin's own namespace.

**Welcome banner on the dashboard.** A `<TipBanner>` at the top of the
dashboard introduces Checkstack's main flow ("add a system, then a health
check") with a one-click jump into the catalog.
