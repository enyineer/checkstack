---
"@checkstack/healthcheck-frontend": minor
"@checkstack/catalog-frontend": minor
---

feat(frontend): guided "create your first check" wizard and onboarding nudges

Add a `FirstCheckWizard`, reachable both from the Health Checks empty state and
an always-available "Quick start" header button: the user picks a system (a new
one or an existing one), pastes a URL, and the wizard creates the HTTP health
check and the assignment (started immediately) in one guided flow, built on the
new `@checkstack/ui` Stepper. This makes guided setup usable when onboarding into
an instance that already has systems and checks, not only on first run.

Also add two in-product nudges: an inline "one system, many environments" hint
on the Create System form (so new users stop cloning a system per stage), and a
clear "what an assignment is and why a check needs one" explainer on the
assignment screen's empty state.
