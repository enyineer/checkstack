---
"@checkstack/ui": patch
"@checkstack/auth-frontend": patch
---

fix(user-menu): bound desktop popover height and fold Profile into the header

The desktop user-menu popover had no max-height constraint, so on short
viewports (split-screen, laptop, browser zoom) the menu extended past the
bottom of the screen and lower items became unreachable. The PopoverContent
now uses `max-h-[var(--radix-popover-content-available-height)]` (the Radix
CSS variable that tracks real available space) together with `overflow-y-auto`
so the menu body scrolls instead of clipping - matching the existing mobile
Sheet behaviour.

The name/email header in the desktop and mobile menus now accepts an optional
`profileHref` prop on `UserMenu`. When provided the header renders as a
focusable `<a>` link (with hover + focus-ring styles) that navigates to the
profile page, supporting middle-click / open-in-new-tab. The standalone
`Account > Profile` menu item in auth-frontend has been removed; the
`Account` group now has no members and no longer renders.
