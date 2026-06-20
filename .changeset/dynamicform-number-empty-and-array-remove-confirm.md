---
"@checkstack/ui": patch
---

DynamicForm: clearing a number/integer field now maps to `undefined` instead of `NaN`, so empty values flow through the normal required-field path and partially-typed input (e.g. `-`, `1.`) no longer thrashes form state. Removing a non-trivial array item (a row with any user-entered value) is now gated behind the shared accessible `ConfirmationModal`; empty / just-added rows are still removed immediately.
