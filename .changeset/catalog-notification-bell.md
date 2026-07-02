---
"@checkstack/notification-common": minor
"@checkstack/notification-backend": minor
"@checkstack/notification-frontend": minor
"@checkstack/catalog-frontend": minor
---

Add the notification bell to the catalog browse page and surface inherited
group subscriptions at a system's bell.

You can now subscribe to notifications directly from the catalog page: a bell on
each group header (covering every system in the group) and a bell on each system
row (subscribing to that one system). Previously the system bell was only
reachable from a system's detail page.

At a system's bell, each notification type now shows an "Inherited from:
`<group>`" hint when you are already reachable via one of the system's groups,
with an "Override here" action that still lets you add a granular, system-only
subscription on top of the inherited group coverage.

Group-level subscriptions, targets, specs and parent edges already existed, so
there is no schema change or migration. A new structural read proc,
`notification.resolveSubscriptionInheritance`, returns per-spec primary and
inherited parent group ids plus their display labels for a
`(targetTypeId, resourceKey)`. It reuses the dispatcher's exact inheritance
derivation (`resolveInheritedGroups` / the extracted pure `mapInheritedGroups`),
so the bell can never disagree with what dispatch delivers. The read is purely
structural (same answer on every pod, resolved from durable tables); per-user
"am I subscribed?" flags stay in `getMySubscriptionStatus`, which the bell folds
the inherited parent group ids into.
