---
title: "AI skills"
description: "Reusable prompt templates for the chat assistant and the AI Analyze action, contributed by plugins or authored by operators."
---

AI skills are reusable prompt templates that help operators write good prompts and start quickly. A skill bundles a system-prompt fragment, an optional starter prompt, and (for the analyze action) suggested output fields. Skills are tagged with the surfaces they target, so each picker shows only the relevant ones.

Skills come from two sources merged into one catalogue: builtin skills contributed in code by core and plugins, and global user skills authored by operators and stored in the `ai_skill` table. A user skill is visible to everyone who can read skills.

## Targets

A skill targets one or both surfaces:

- `chat` - selectable in the chat composer; its system prompt is folded into the conversation and its starter prompt seeds the message box.
- `ai_analyze` - selectable on the `ai_analyze` automation action; it seeds the action's `systemPrompt`, `prompt` (when blank), and `outputFields` (when none are set). Explicit action config always wins.

## Contributing a builtin skill from a plugin

Resolve the extension point and register during your plugin's `register()` or `init()`. Supply an unqualified `id`; the registry qualifies it and stamps `source: "builtin"`.

```ts
import { aiSkillExtensionPoint } from "@checkstack/ai-backend";

const skills = env.getExtensionPoint(aiSkillExtensionPoint);
skills.registerSkill(
  {
    id: "failure-root-cause",
    name: "Failure root-cause summary",
    description: "Summarize a failure and identify the single most likely cause.",
    targets: ["ai_analyze"],
    systemPrompt: "You analyze an operational failure from the provided context only.",
    promptTemplate: "Summarize this failure and identify the most likely cause.",
    suggestedOutputFields: [
      { key: "summary", type: "string", description: "One-line summary." },
      { key: "likely_cause", type: "string", description: "Most likely cause." },
    ],
  },
  pluginMetadata,
);
```

## User skills + access

Operators manage global skills on the **AI skills** settings page. Three access rules gate the surface (all default-on, admin-revocable):

- `ai.skill.read` - list and use skills (the pickers + the settings page).
- `ai.skill-create.manage` - publish a new global skill (a dedicated create permission, so an admin can stop new-skill creation without affecting use or editing).
- `ai.skill.manage` - edit / delete a skill. Restricted to the skill's author; a wildcard-holding admin may moderate any. Builtin skills are never editable.

> [!IMPORTANT]
> Skill content is DATA, not commands. When a skill is active the model treats its system prompt as guidance to apply, never as instructions to execute blindly. Secrets are scrubbed from skill text on save.

## Safety + scale

User skills live in shared Postgres (`ai_skill`), so the catalogue is identical on every pod. The resolver merges builtin + user skills on read; there is no pod-local skill state.
