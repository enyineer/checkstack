---
"@checkstack/frontend-api": minor
"@checkstack/auth-frontend": patch
"@checkstack/frontend": patch
"@checkstack/infrastructure-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/ui": patch
"@checkstack/ai-backend": patch
---

Hide navigation, actions and links that the current user cannot use, so anonymous
and read-only users no longer see entries that lead to "Access Denied" or to
actions the server would reject.

- **Sidebar**: a nav entry can now declare a dynamic `nav.isVisible({ accessRules, isAuthenticated })` predicate (in addition to the static `accessRule`). A group whose every entry is filtered out is no longer rendered. The filtering/grouping logic is extracted to a pure, unit-tested helper.
- **Infrastructure**: its sidebar entry is shown only when the user can READ at least one contributed tab (queue, cache, …), instead of always (it previously had no static rule because tabs are contributed at runtime).
- **Notification Settings**: hidden from anonymous users - notifications are per-user, so an anonymous visitor can't have any.
- **Anomaly Mute / Suppress**: the "Mute" / "Mute all" controls (a per-user preference) are hidden from anonymous visitors; the "Suppress" control is gated on `anomalyAccess.feed.manage`. Both were previously always visible.
- **Dashboard**: the "Open Catalog" actions (which open the manage-only Catalog config page) are hidden from users without `catalogAccess.system.manage`, and the "View catalog" link is gated on `catalogAccess.system.read`.

The `@checkstack/ai-backend` bump is only the regenerated bundled docs index
(the frontend routing guide gained the `nav.isVisible` section); no code change.

**BREAKING (`@checkstack/frontend-api`):** the `AccessApi` interface gains a
required `useIsAuthenticated()` method. Custom `AccessApi` implementations must
add it (it returns `{ loading, isAuthenticated }`). The built-in auth
implementation and the no-auth fallback already do. `NavEntry` also gains an
optional `isVisible` predicate (purely additive).
