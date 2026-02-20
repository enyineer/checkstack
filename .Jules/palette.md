## 2026-02-20 - [LoadingSpinner Padding Trap]
**Learning:** `LoadingSpinner` has baked-in `py-12` (large vertical padding), making it unusable in small contexts (buttons, inline) without override.
**Action:** Atomic components should have 0 padding by default; let the layout container or explicit props control spacing.
