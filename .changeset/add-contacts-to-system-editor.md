---
"@checkstack/catalog-frontend": minor
"@checkstack/catalog-common": patch
"@checkstack/ui": patch
---

Add contacts management to system editor

- **catalog-frontend**: New `ContactsEditor` component allows adding/removing platform users and external mailboxes as system contacts directly from the system editor dialog
- **catalog-common**: Added `instanceAccess` override to contacts RPC endpoints for correct single-resource RLAC checking
- **ui**: Fixed Tabs component to use `type="button"` to prevent form submission when used inside forms
