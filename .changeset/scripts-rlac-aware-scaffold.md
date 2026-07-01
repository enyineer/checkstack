---
"@checkstack/scripts": minor
---

Make the `bun run create` plugin scaffold RLAC-aware. A newly generated plugin's
`*-common/access.ts` now exports a `<plugin>ResourceTypes` constant derived from
the SAME noun the access rule uses (`accessPair("item", ...)` +
`resourceType(pluginMetadata, "item")`), so the frontend capability type cannot
drift from the middleware's grant key. The contract and frontend templates carry
inline guidance on team-scoping (which `instanceAccess` mode to use) and the
required `manageCapability`, pointing at `.claude/rules/rlac.md` and
`bun run check:manage-capabilities`.
