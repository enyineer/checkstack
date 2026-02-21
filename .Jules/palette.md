
## 2025-05-18 - Missing ARIA Labels on Icon Buttons
**Learning:** The `Button` component with `size="icon"` is frequently used without an `aria-label`, making interactive elements invisible to screen readers. This pattern is common in dynamic form controls (add/remove items) and pickers.
**Action:** When creating or reviewing icon-only buttons, always enforce `aria-label` or `aria-labelledby`. Add a lint rule or component prop requirement if possible in the future.
