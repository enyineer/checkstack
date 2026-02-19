---
"@checkstack/ui": patch
"@checkstack/test-utils-frontend": patch
---

Performance optimization: `AnimatedNumber` now uses direct DOM manipulation to avoid React re-renders during animation, significantly reducing main thread work.
Bug fix: `test-utils-frontend` setup now correctly registers global DOM environment before importing testing library modules.
