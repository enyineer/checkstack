---
"@checkstack/common": patch
---

Add centralized `extractErrorMessage()` utility and enforce stricter code quality rules.

- New `extractErrorMessage(error, fallback?)` utility for consistent error message extraction
- ESLint: Install `eslint-plugin-react-hooks` for hook correctness enforcement
- ESLint: Ban `instanceof Error` pattern via `no-restricted-syntax` (use `extractErrorMessage` instead)
- ESLint: Ban `console.*` in frontend packages via `no-console` rule
- ESLint: Custom `no-eslint-disable-any` rule to prevent `@typescript-eslint/no-explicit-any` circumvention
- Replace 141 `instanceof Error` boilerplate patterns across the codebase
- Replace swallowed `console.error` calls with user-visible `toast.error()` feedback
- Fix conditional React hook call in `FormField.tsx`
- Remove `as any` casts in `config-versioning.ts` and `ExtensionSlot.tsx`
