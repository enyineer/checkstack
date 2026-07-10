---
"@checkstack/ui": minor
"@checkstack/frontend-api": minor
"@checkstack/tips-frontend": minor
"@checkstack/frontend": patch
"@checkstack/command-frontend": patch
"@checkstack/auth-frontend": patch
"@checkstack/theme-frontend": patch
"@checkstack/about-frontend": patch
---

fix(frontend): de-clutter the navbar and move Help into the user menu

The navbar carried six tap targets (hamburger, logo, search, help, avatar +
chevron, bell) in a bar barely wide enough for four on mobile, and the `?` icon
sat in the right-hand rail as a peer of the notification bell and the avatar
despite being neither a stateful indicator nor an identity control.

- **Help moves into the user menu**, at both breakpoints, contributed by
  `tips-frontend` to `UserMenuItemsBottomSlot`. Its Documentation link is
  dropped rather than reproduced: the sidebar's Documentation group already
  renders a `Docs` external link on both the desktop rail and the mobile drawer.
  What remains ("Show tips again" plus the lightbulb/tooltip legend) are tips
  concepts that `tips-frontend` already owns, so the shell no longer needs a
  `HelpMenu` component at all - it is deleted, along with `core/frontend`'s now
  unused dependency on `@checkstack/tips-frontend`.
- **The search trigger** is hidden below `md`; the mobile drawer already has a
  "Search..." entry that opens the same palette. It is hidden with CSS rather
  than unmounted, because `NavbarSearch` owns the palette's open state and the
  ⌘K listener that `openSearchPalette()` re-dispatches into.
- **The user-menu chevron** and name label are dropped below `md`, and the
  trigger's horizontal padding tightens so the tap target is centred on the bare
  avatar rather than an off-centre pill.

The mobile navbar is now hamburger, logo, avatar, bell.

Two defects found on the way:

- `UserMenu`'s trigger had **no accessible name**. The avatar is decorative and
  the name label is hidden on small screens, so the button was announced as just
  "button". It now carries an `aria-label`.
- User-menu contributions were ordered by plugin load order, because the slot
  declared no metadata type and `ExtensionSlot` sorts on an optional `priority`.
  Every contributor now declares one, so the menu renders Help, appearance
  toggles, About, Logout deterministically, with Logout pinned last.

The two user-menu slots are also collapsed into one. `UserMenuItemsSlot` had not
been rendered by anything since navigation moved to the sidebar - its render site
was removed and the definition left behind - so every real contribution went to
`UserMenuItemsBottomSlot`, and a "bottom" section existed with no top section
above it. The docs additionally described a `group`-based system for the top slot
(canonical `Workspace` / `Reliability` / `Configuration` headers, alphabetized
custom groups) that was never implemented: nothing read `metadata.group`. The
surviving slot is `UserMenuItemsSlot`, ordering is expressed with `priority`, and
the fictional grouping is gone from the docs.

BREAKING CHANGE: `useIsMobile()` now matches `(max-width: 767px)` instead of
`(max-width: 640px)`. It must agree with the app shell's layout breakpoint - the
hamburger is `md:hidden` and the sidebar rail is `hidden md:flex`, so "the shell
is in its mobile layout" means below `md`. Previously the 641-767px range
rendered the mobile hamburger while `useIsMobile()` still reported `false`, so
the user and notification menus opened as desktop popovers inside a mobile
layout. Consumers outside the shell (`HealthCheckHistoryDetailPage`,
`SloTrendChart`) now switch to their mobile presentation 128px earlier.

BREAKING CHANGE: `UserMenuItemsBottomSlot` is removed. Contribute to
`UserMenuItemsSlot` instead - it is now the menu's only item slot and is actually
rendered. `UserMenuItemsMetadata` loses its never-implemented `group` key and
gains `priority?: number`, which orders items ascending (lower first). A
contribution registered through the type-strict `createSlotExtension` helper must
now pass a `metadata` object; plain-object `extensions` entries may omit it and
default to priority 0.
