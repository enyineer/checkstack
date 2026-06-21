---
"@checkstack/ui": minor
"@checkstack/pluginmanager-frontend": patch
---

Fold the typed-phrase confirmation gate into the shared `ConfirmationModal`.

`ConfirmationModal` now accepts an optional `confirmPhrase` (plus
`confirmPhraseLabel` and `confirmPhrasePlaceholder`): when set, it renders an
input and keeps the confirm button disabled until the typed value matches the
phrase exactly. The typed value resets whenever the modal reopens. The `message`
prop is widened from `string` to `React.ReactNode` so callers can pass rich
descriptions; existing string call sites are unaffected. A pure
`isConfirmPhraseSatisfied` predicate backs the enable/disable logic and is unit
tested.

The pluginmanager install and uninstall flows now use `ConfirmationModal` with
`confirmPhrase`, and the parallel hand-rolled `TypedConfirmModal` (which lacked
focus trap, Escape-to-close, scroll-lock, and focus restoration) is removed.
Behavior and UX (phrase gate, danger/warning styling, confirm action) are
preserved, now on the accessible Radix Dialog base.
