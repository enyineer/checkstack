---
"@checkstack/auth-frontend": minor
---

Improve form quality in auth dialogs (role, scope-to-team, create application).

The Role and Scope-to-team dialog bodies are now wrapped in `<form onSubmit>`
with a `type="submit"` primary button, so pressing Enter submits the dialog
(matching the catalog System editor and Create User dialog). Mandatory fields
carry the `Label required` affordance and native `required`, the first field of
each dialog auto-focuses on open, and the scope-to-team Team / Access level
selects are now associated with their labels via `htmlFor`/`id`.

The Create Application dialog gains native `required` on the name input, a
disabled-until-`name.trim()`-is-non-empty Create button (aligning with the
Create User / System editor pattern), and an auto-focused name field; its body
is wrapped in `<form onSubmit>` so Enter submits. No behavioral change to the
underlying mutations or role/team logic.
