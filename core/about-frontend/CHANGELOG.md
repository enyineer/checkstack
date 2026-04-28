# @checkstack/about-frontend

## 0.2.11

### Patch Changes

- Updated dependencies [c4e7560]
  - @checkstack/frontend-api@0.3.10
  - @checkstack/ui@1.5.1

## 0.2.10

### Patch Changes

- Updated dependencies [3da7582]
  - @checkstack/ui@1.5.0

## 0.2.9

### Patch Changes

- Updated dependencies [bb1fea0]
- Updated dependencies [bb1fea0]
  - @checkstack/ui@1.4.0

## 0.2.8

### Patch Changes

- Updated dependencies [4b0934d]
  - @checkstack/ui@1.3.6

## 0.2.7

### Patch Changes

- Updated dependencies [286491a]
  - @checkstack/ui@1.3.5

## 0.2.6

### Patch Changes

- Updated dependencies [692c717]
  - @checkstack/ui@1.3.4

## 0.2.5

### Patch Changes

- Updated dependencies [594eecc]
  - @checkstack/ui@1.3.3

## 0.2.4

### Patch Changes

- Updated dependencies [0388000]
  - @checkstack/ui@1.3.2

## 0.2.3

### Patch Changes

- Updated dependencies [765b764]
  - @checkstack/ui@1.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [26d8bae]
  - @checkstack/ui@1.3.0

## 0.2.1

### Patch Changes

- d1a2796: Enforce stricter code quality standards and eliminate AI slop anti-patterns.

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

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5
  - @checkstack/ui@1.2.1
  - @checkstack/frontend-api@0.3.9
  - @checkstack/about-common@0.2.1

## 0.2.0

### Minor Changes

- 3589199: Add About page with platform information, license, contact details, and version information

  - New `about-common` package with plugin metadata
  - New `about-frontend` package with the About page and user menu item
  - New `/api/about` backend endpoint exposing core version and loaded plugin versions
  - Accessible via "About Checkstack" in the user menu dropdown

### Patch Changes

- Updated dependencies [3589199]
  - @checkstack/about-common@0.2.0
