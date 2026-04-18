---
"@checkstack/common": patch
"@checkstack/ui": patch
"@checkstack/auth-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/dashboard-frontend": patch
"@checkstack/backend": patch
"@checkstack/backend-api": patch
"@checkstack/integration-teams-backend": patch
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
