## 2024-05-23 - DateTimePicker Accessibility
**Learning:** Complex segmented inputs (like date/time pickers) often rely on visual layout (DD/MM/YYYY) and miss accessible names for individual segments.
**Action:** Always add `aria-label` to each segment input (Day, Month, Year, etc.) to ensure screen readers announce the specific field context, not just the value.
