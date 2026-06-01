---
"@checkstack/automation-common": patch
---

fix(automation-common): remove polynomial-time backtracking from `toShellEnvKey`

The underscore-trim step used the naive `/^_+|_+$/g` pattern, whose trailing
alternative can start matching anywhere within a run of underscores, giving
quadratic match time on adversarial input (CodeQL `js/polynomial-redos`). A
negative look-behind now anchors where the trailing run may begin, keeping the
trim linear regardless of input shape.
