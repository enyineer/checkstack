---
"@checkstack/cache-frontend": patch
---

Add a stacked card layout to the cache runtime entries table on narrow
viewports. Below the `sm` breakpoint the Key/Size/TTL table renders as a
`MobileCardList` instead of relying on horizontal scroll; the desktop table is
unchanged.
