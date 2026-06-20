---
"@checkstack/integration-frontend": patch
---

Add a stacked card layout to the provider documentation HTTP headers table on
narrow viewports. Below the `sm` breakpoint the Header/Description table renders
as a `MobileCardList` instead of relying on horizontal scroll; the desktop table
is unchanged.
