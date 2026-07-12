# Linting

Always run "bun run lint" in the project root after you've made changes to make sure that you're not breaking any linter rules. If there are linter errors, fix them before considering your changes done.

Always run "bun run typecheck" in the project root after you've made changes to make sure that you're not breaking any type checks. If there are type check errors, fix them before considering your changes done.

Setting "eslint-disable-next-line @typescript-eslint/no-explicit-any" is STRICTLY FORBIDDEN. NEVER USE "any" as an explicit type!

# Validation

When type-checking or validation of a type is necessary, ALWAYS use the library "zod" and write zod-schemas.

# Code structure

ALWAYS keep the code well structured and modular.

ALWAYS use typed objects for function arguments, try to avoid positional arguments. ALWAYS use object destructuring in functions to destructure the "props" given to the function.

# Opaque surfaces

Card-like containers (anything with a border/rounded box holding content)
must declare their OWN opaque background (`bg-card`, `bg-surface`,
`bg-surface-inset`, ...) - NEVER rely on inheriting the page behind them.
Several pages render decorative backdrops (e.g. the detail pages' grid
pattern); a bordered box without a background lets the backdrop bleed through
the content, which badly hurts readability. A component styled inside an
opaque parent (a Dialog, a Card) may look fine there and still be broken the
first time someone mounts it on a page - so the container itself carries the
background. Translucent backgrounds (`bg-*/50`) are only acceptable for
accents INSIDE an already-opaque surface, never for the surface itself.

# Frontend query invalidation

Every oRPC `useMutation()` already invalidates its owning plugin's
queries on success — do NOT add manual `refetch()` / `invalidateQueries`
calls for queries in the same plugin. For mutations that affect a
*different* plugin's data, explicitly call
`queryClient.invalidateQueries({ queryKey: [[otherPluginId]] })` in
`onSuccess`. Editor pages that seed local state from a query once (e.g.
via `useInitOnceForKey`) MUST set `gcTime: 0` on the loader query —
otherwise stale-while-revalidate races the one-shot init and reopened
editors show pre-mutation data. Full rationale: see
`docs/src/content/docs/frontend/query-invalidation.md`.
