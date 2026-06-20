---
"@checkstack/status-page-frontend": patch
---

Give the status-page builder's "Add a block" widget-type select an explicit
`aria-label`. A `combobox` derives its accessible name from `aria-label` /
`aria-labelledby`, not from its placeholder child text, so the control was
previously announced as an unlabeled combobox to screen-reader users. Labeling
it also makes the control reliably targetable by assistive tech and tests.
