---
"@checkstack/common": patch
"@checkstack/ui": patch
"@checkstack/auth-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/backend": patch
"@checkstack/backend-api": patch
"@checkstack/integration-teams-backend": patch
"@checkstack/about-frontend": patch
"@checkstack/announcement-frontend": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/auth-backend": patch
"@checkstack/catalog-backend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/dependency-backend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/frontend-api": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/integration-backend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-backend": patch
"@checkstack/notification-frontend": patch
"@checkstack/queue-backend": patch
"@checkstack/queue-frontend": patch
"@checkstack/theme-frontend": patch
"@checkstack/auth-ldap-backend": patch
"@checkstack/auth-saml-backend": patch
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/integration-jira-backend": patch
"@checkstack/integration-webex-backend": patch
"@checkstack/integration-webhook-backend": patch
"@checkstack/notification-backstage-backend": patch
"@checkstack/notification-discord-backend": patch
"@checkstack/notification-gotify-backend": patch
"@checkstack/notification-pushover-backend": patch
"@checkstack/notification-slack-backend": patch
"@checkstack/notification-smtp-backend": patch
"@checkstack/notification-teams-backend": patch
"@checkstack/notification-telegram-backend": patch
"@checkstack/notification-webex-backend": patch
"@checkstack/queue-bullmq-backend": patch
---

Enforce stricter code quality standards and eliminate AI slop anti-patterns.

**New utility**
- `extractErrorMessage(error, fallback?)` in `@checkstack/common` for consistent error extraction

**ESLint rules**
- `react-hooks/rules-of-hooks` and `exhaustive-deps` for hook correctness
- `no-console` in frontend packages — forces `toast` over silent `console.error`
- `no-restricted-syntax` banning `instanceof Error` — forces `extractErrorMessage`
- Custom `no-eslint-disable-any` rule preventing `@typescript-eslint/no-explicit-any` circumvention

**Refactoring**
- Replace 141 `instanceof Error` boilerplate patterns across the codebase
- Replace swallowed `console.error` with user-visible `toast.error()` feedback
- Remove 15 redundant `as` type casts in IntegrationsPage and ProviderConnectionsPage
- Consolidate 3 identical callback handlers into `handleDialogClose`
- Fix conditional React hook call in `FormField.tsx`
- Fix unstable useMemo deps in `Dashboard.tsx`
- Replace `useEffect`→`setState` with derived `useMemo` in `RegisterPage.tsx`
- Rewrite `keystore.test.ts` with typed `DrizzleMockChain` (eliminating 7 `any` suppressions)
- Delete obvious comments in `encryption.ts` and Teams `provider.ts`
