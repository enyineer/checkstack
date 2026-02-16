## 2026-02-16 - Accessible Icon Buttons
**Learning:** Icon-only buttons (like password toggles) in form components often use raw SVGs and lack `aria-label`, making them inaccessible to screen readers.
**Action:** Replace raw SVGs with `lucide-react` icons and always add `aria-label` to icon-only buttons.
