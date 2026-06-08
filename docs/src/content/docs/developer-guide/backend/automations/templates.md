---
title: "Automation templates"
description: "Contribute curated example automations to the new-automation picker, and how startup validation keeps them from drifting."
---

Automation templates are curated, ready-to-use example automations an operator can start from instead of facing a blank editor. Creating a new automation opens a picker at `/automation/new` that lists templates grouped by category, plus a "Blank automation" option. Selecting a template seeds the editor; the operator still chooses a `runAs` service account and saves it themselves, so a template never creates anything on its own.

A template is just a validated [`AutomationDefinition`](/checkstack/developer-guide/backend/automations/primitives/) plus presentation metadata. Core and external plugins both contribute templates through the `automationTemplateExtensionPoint`, exactly like triggers, actions, and artifact types.

## Registering a template

Resolve the extension point and register your template during `register()` (or `init()`). Supply an unqualified `id`; the registry qualifies it with your plugin id and stamps `ownerPluginId` for the attribution badge.

```ts
import { automationTemplateExtensionPoint } from "@checkstack/automation-backend";

const templates = env.getExtensionPoint(automationTemplateExtensionPoint);
templates.registerTemplate(
  {
    id: "page-on-call-on-sustained-degradation",
    name: "Page on-call on sustained degradation",
    description:
      "Notify an on-call user when a system stays degraded for 5 minutes.",
    category: "Alerting",
    icon: "BellRing", // any lucide icon name
    definition: {
      name: "Page on-call on sustained degradation",
      triggers: [
        { event: "healthcheck.system_degraded", for: { minutes: 5 } },
      ],
      conditions: [],
      actions: [
        {
          id: "page_oncall",
          action: "automation.notify_user",
          config: {
            userId: "REPLACE_USER",
            title: "System {{ trigger.payload.systemName }} degraded",
            body: "Sustained degradation - investigate now.",
            importance: "critical",
          },
        },
      ],
    },
  },
  pluginMetadata,
);
```

A contributor may omit schema defaults (`enabled`, `continue_on_error`, `conditions`, `mode`); the registry normalizes the template by parsing it through the canonical schema on registration.

### Operator-fill placeholders

Fields the template cannot know - connection ids, project keys, a target user - should carry a clear non-empty placeholder string (for example `REPLACE_USER`). The placeholder keeps the definition structurally valid, and because it does not match any option, the editor renders the field as unselected so the operator is prompted to choose. Resolver-backed fields are not checked against live connections at template time; that check runs when the operator saves.

## Startup validation (no silent drift)

Because a template's `definition` references concrete trigger, action, and artifact ids, the backend validates every registered template against the live registries once at startup (after all plugins are ready):

- **Capability not installed** - a referenced trigger/action belongs to a plugin that is not installed. The template is withheld and a `warn` is logged naming the missing capabilities. This is expected on instances that do not have an optional integration.
- **Interface drift** - every referenced capability is installed, but the definition no longer validates (a renamed/removed config field, a changed artifact-type id, a bad reference). The template is withheld and an `error` is logged with the exact issues.

Only templates that fully validate are served to the picker, so an operator can never start from a broken template. When you change an action, trigger, condition, or artifact interface, update any template that references it in the same change - the startup error tells you exactly what broke.

> [!TIP]
> Place a template in the plugin that owns the most specialized capability it
> uses. Cross-capability templates (for example an AI-triage flow that also
> files a Jira issue) may be shipped from core; they simply stay hidden, with a
> warning, on instances where a referenced integration is absent.
