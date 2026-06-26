---
"@checkstack/ui": minor
"@checkstack/frontend": minor
---

fix(mobile): make the nav drawer fully scrollable and de-clutter the navbar

The mobile navigation drawer (`Sheet`) spanned the layout viewport
(`inset-y-0 ... h-full`), so on a phone its bottom - and the last menu items -
sat behind the browser URL bar and could not be reached. The sheet is now bound
to the dynamic viewport (`h-[100dvh]`, top-anchored), so it ends at the visible
bottom and scrolls to the last item.

The "Checkstack" wordmark in the navbar is now hidden below the `sm` breakpoint
(the logo still anchors the home link), freeing space on the cramped mobile
navbar.
