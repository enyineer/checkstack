---
"@checkstack/ui": minor
---

DynamicForm now passes row-scoped form values to `x-options-resolver` fields
inside array-of-object items, so an item field's dynamic options can depend on
its own row's sibling fields (in addition to the whole-form values). Previously
a resolver inside an array item only ever saw the top-level form values, so a
`{ key, value }` filter row could not resolve its `value` options from that
row's own `key`.

The row's own fields are merged OVER the whole-form values (a row field shadows
a same-named top-level field), and the `x-depends-on` refetch tracking reads the
same merged object, so a `value` field declaring `x-depends-on: ["metricName",
"key"]` refetches when its row's `key` changes. Backward compatible: existing
top-level resolver reads are unchanged; only array-item resolvers gain the extra
row scope. Exposed as the pure helper `scopeArrayItemFormValues` (unit-tested)
with a new `ArrayOfDynamicObjects` Storybook story demonstrating the pattern.
