---
"@checkstack/common": minor
"@checkstack/auth-common": minor
"@checkstack/auth-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/slo-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/ai-frontend": minor
---

Add point-of-use coaching across the feature config pages and onboarding.

- The deep-link registry (`@checkstack/common`'s `APP_DOC_SLUGS`) now exposes
  the core-concept docs pages (systems and groups, health checks, SLOs,
  incidents). Each is verified against the real docs content by the existing
  `docs-links.test.ts` rename guard.
- The catalog, health-check, SLO and incident config pages now carry a
  one-time, dismissable `TipBanner` with a concise orientation sentence and an
  inline "Learn more" deep-link to the matching concept page, so first-time
  visitors get oriented and returning users keep a persistent header
  subtitle plus a replayable banner. The same "Learn more" link is also added
  inside each page's existing concept `<Tip>` popover (catalog has no `<Tip>`,
  so it gains only the banner).
- The first-run onboarding form now shows a LIVE per-criterion password
  checklist that ticks green as you type, replacing the static rules text and
  the submit-only destructive error list. The criteria live in
  `@checkstack/auth-common` (`PASSWORD_CRITERIA` / `evaluatePasswordCriteria`),
  kept in lock-step with `passwordSchema` and covered by a unit test.
- The AI chat empty state now leads with orientation-style example prompts
  ("Explain SLOs and how they relate to health checks", "How do I add a system
  to the catalog?") alongside the existing task prompts; clicking one seeds the
  composer for editing. The prompts only appear when an AI integration is
  configured.
