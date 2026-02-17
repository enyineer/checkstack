## 2026-02-17 - Missing Dev Dependencies in UI Package
**Learning:** The `core/ui` package was missing `@testing-library/react` and related packages as devDependencies, causing typecheck failures in CI even though local tests might have passed due to hoisting or other factors.
**Action:** Always verify `package.json` dependencies when encountering "Cannot find module" errors during typechecking, especially after merging main.
