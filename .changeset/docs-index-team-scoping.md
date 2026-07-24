---
"@checkstack/ai-backend": patch
---

Regenerate the docs search index for the updated team-access documentation

The "Teams and access" concept page and the "Create a team" guide were updated
to describe team-scoped visibility (a member or manager sees and manages their
own team without the global `auth.teams.read` rule, and the Teams page is open
to any signed-in user). The AI assistant's docs index now reflects that wording.
