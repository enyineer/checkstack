# Palette's Journal - UX & Accessibility Learnings

## 2025-02-18 - [Loading Spinner Accessibility]
**Learning:** Loading spinners without `role="status"` and visually hidden text are completely silent to screen readers, causing confusion during async operations.
**Action:** Always add `role="status"` and a `.sr-only` text element (e.g., "Loading...") to all loading indicators to ensure they are announced.
