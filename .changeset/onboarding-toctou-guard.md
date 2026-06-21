---
"@checkstack/auth-backend": patch
---

fix(auth-backend): close first-run onboarding TOCTOU race

`completeOnboarding` (the anonymous first-run mutation that creates the first
admin) now takes a transaction-scoped advisory lock and re-checks "no users
exist" INSIDE the transaction. Previously the existence check ran in a separate
statement before the insert transaction, so two concurrent first-run calls with
different emails could both pass the guard and both create an admin user during
the brief unbootstrapped window. The lock serializes onboarding attempts so the
second caller observes the first caller's committed admin and is rejected.
