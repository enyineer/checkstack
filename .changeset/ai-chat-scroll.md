---
"@checkstack/ui": patch
"@checkstack/frontend": patch
"@checkstack/ai-frontend": patch
---

Fix the double-scrolling on the AI chat page (`/ai/chat`). The page sized its
layout with a fixed `calc(100vh - 220px)` height, which overshot the available
space when the page subtitle wrapped to two lines - so the whole page scrolled
on top of the message list's own scroll.

`PageLayout` gains an opt-in `fillHeight` prop that fills the viewport via a
bounded flex height chain (established in the app shell) instead of viewport
math; the chat page uses it so only the message list scrolls and the page itself
never does. Normal document-flow pages are unaffected (they still scroll the
main area as before).
