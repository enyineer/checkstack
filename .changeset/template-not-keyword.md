---
"@checkstack/template-engine": patch
---

Support `not` as a prefix negation keyword in condition/template expressions
(e.g. `not artifacts.search.issue_search.found`), matching the documented
pattern and what `!` already does. Previously only `!` was accepted and the
`not` keyword threw `Expected EXPR_CLOSE but found IDENT`, so a `choose`/
condition that used the (advertised) `not ...` form failed to evaluate at run
time. The `not` FILTER (`value | not`) is parsed after a pipe and is unaffected.
