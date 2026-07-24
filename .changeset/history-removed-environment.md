---
"@checkstack/healthcheck-frontend": patch
---

Stop the history page labelling live environments as "Removed environment"

The health-check history page showed "Removed environment" beside runs whose
environment was perfectly healthy - while opening the same run showed the
environment correctly.

The page rendered the runs table without passing `environmentLabels` at all. The
prop was optional, so the table received no environment names, found nothing to
resolve each run's id against, and fell back to its "this environment no longer
exists" label. Every other caller passed the prop; the history page was the only
one that did not, which is why the bug appeared on exactly one screen.

The page now resolves names from every environment in the instance (as the other
screens do) and holds its rows until they load, so a still-loading environment
cannot flash as removed either.

The prop is now REQUIRED on both run lists. "Removed environment" is a claim
that an id is absent from the complete list, which is only sound if the complete
list was actually supplied - and while the prop was optional, forgetting it
produced a confident lie rather than a visible gap. The three cases (env-less,
named, genuinely removed) are now resolved by one tested helper instead of a
lookup that could not tell "no list" from "not in the list".

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
