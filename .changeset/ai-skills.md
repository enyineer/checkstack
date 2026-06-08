---
"@checkstack/ai-common": minor
"@checkstack/ai-backend": minor
"@checkstack/ai-frontend": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/backend-api": minor
"@checkstack/ui": minor
---

Add AI "skills" - reusable prompt templates for the chat assistant and the
`ai_analyze` automation action. A skill bundles a system-prompt fragment, an
optional starter prompt, and (for analyze) suggested output fields, tagged with
the surfaces it targets.

Skills come from two sources merged into one catalogue: builtin skills
contributed by core/plugins via the new `aiSkillExtensionPoint`, and GLOBAL
user skills authored by operators (new `ai_skill` table) and visible to everyone
who can read skills. New access rules `ai.skill.read`, `ai.skill-create.manage`
(a dedicated create permission), and `ai.skill.manage` (edit/delete, author-only
with admin moderation) gate the feature - all default-on, admin-revocable.

The chat composer gains a skill picker (its system prompt seeds the turn, its
starter prompt seeds the message box); the `ai_analyze` action gains an optional
`skillId` that seeds the system prompt, prompt (when blank), and output fields
(when none) - explicit config always wins. A new "AI skills" settings page lets
operators browse, view full details (prompts + output fields), publish, edit,
and delete their global skills. Ships six builtin skills across chat and analyze.

To support rich pickers, `@checkstack/ui`'s `DynamicForm` gains a `catalog`
options style (`x-options-style: "catalog"`, with resolver options carrying an
optional `description`) that renders a browsable modal of cards instead of a
plain Select, and `@checkstack/backend-api` propagates the new annotation. The
shared `PageHeader` now wraps a long subtitle beside its actions instead of
letting them overlap.
