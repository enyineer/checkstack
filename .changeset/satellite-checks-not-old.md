---
"@checkstack/healthcheck-frontend": patch
---

Stop labelling live satellite checks as "Old checks"

On a system that has environments, a check assigned to both the local core and a
satellite showed the satellite's results under "Old checks" the moment the
satellite first reported - even though they were the freshest data on the page.

The cause is that satellites are handed no environment information: every result
a satellite reports is written env-less. The overview decided a slice was old
STRUCTURALLY - an env-less slice must be historical, it reasoned, because a check
that fans out per environment cannot still be writing env-less runs. That held
while only the local executor wrote runs, and satellites break it.

The rule now means what its name says: an env-less slice is old only when it has
actually stopped receiving runs, judged from its own run timestamps against the
check's interval, with a generous allowance (five missed intervals, and a
ten-minute floor) so a probe that is merely slow or backing off is never
mistaken for a dead one. A slice that has never run at all is pending, not old.

A concrete environment that left the system, or was disabled for the assignment,
is still called old immediately - that verdict is certain, so making it wait
would only delay a correct label.

This fixes the mislabelling. The underlying gap - satellites receiving no
environment context, so satellite checks contribute no per-environment health -
is tracked separately.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
