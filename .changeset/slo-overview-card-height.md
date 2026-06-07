---
"@checkstack/slo-frontend": patch
---

fix(slo): make SLO overview cards fill their grid cell height

On the SLO Dashboard the cards are wrapped in stretched grid items
(`items-stretch`), so each card's anchor grew to the tallest card in its row
while the card inside kept its natural height - leaving empty space below the
shorter cards. The card and its anchor now use `h-full` so the card fills the
cell and all cards in a row line up.
