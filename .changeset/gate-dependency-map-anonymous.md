---
"@checkstack/dependency-common": patch
"@checkstack/dependency-frontend": patch
"@checkstack/ai-backend": patch
---

fix(dependency): gate the dependency map behind its own non-public access rule

Anonymous users could see the "Dependency Map" nav entry and open the page
(which then rendered empty) because the map was gated by `dependency.read`,
which is public so that dependency *warning* badges stay visible on the
catalog and dashboard.

The full topology map is now gated by a dedicated `dependency.map` access
rule that is granted to authenticated users by default but is NOT public, so
anonymous visitors no longer see the nav entry or reach the page. The
`getAllDependencies`, `getNodePositions`, and `saveNodePositions` endpoints
move to this rule too, and the dashboard dependency signal now renders as
plain text (not a map link) for users without map access. Per-system
dependency warnings stay on the public `dependency.read` rule, so warning
badges/alerts/signals remain visible to everyone as before.

Admins can still grant `dependency.map` to the anonymous role to make the
map public again.

Note: the default-rule sync is add-only, so on existing deployments the
anonymous role keeps any rules already granted. Since `dependency.map` is a
brand-new rule the anonymous role never had it, so the map is hidden from
anonymous users immediately after upgrade with no admin action required.
