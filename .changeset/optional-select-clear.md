---
"@checkstack/ui": patch
---

Add "None" option to optional Select fields in DynamicForm

**Bug Fix:**
- Optional select fields (using `x-options-resolver` or enums) now display a "None" option at the top of the dropdown
- Selecting "None" clears the field value, allowing users to unset previously selected values
- This fixes the issue where optional fields like `defaultRole` in authentication strategies could not be cleared after selection
