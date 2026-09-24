---
"@checkstack/backend": patch
---

Register the api-docs access rule (`api-docs.api-docs.read`) with the plugin manager. The rule was defined but never registered, so it never appeared in the Edit Role dialog, was never granted to the `users` role, and only wildcard admins could open the API docs page or `GET /api/openapi.json`. It now shows up under the "Api Docs" category, is granted to authenticated users by default, and can be granted to any role.
