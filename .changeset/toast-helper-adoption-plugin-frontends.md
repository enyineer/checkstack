---
"@checkstack/incident-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/automation-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/ai-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/auth-frontend": patch
---

Adopt the canonical `toastError` helper from `@checkstack/ui` for error toasts.

Error toasts that previously called `toast.error(extractErrorMessage(error, "Failed to X"))`
(or interpolated `Failed to X: ${extractErrorMessage(error)}` strings) now use
`toastError(toast, "Failed to X", error)`. This centralizes the
"Failed to <action>: <message>" voice and applies the shared 100-character
truncation. Error toasts that did not previously prefix the action now gain the
canonical prefix; success toasts and terse validation one-liners are unchanged.
