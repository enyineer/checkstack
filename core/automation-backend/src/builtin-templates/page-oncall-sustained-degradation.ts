import type { AutomationTemplateInput } from "@checkstack/automation-common";

/**
 * Alerting: page an on-call user only when a system stays degraded for a dwell
 * window (5 minutes), so transient blips that self-recover never page anyone.
 * Uses only core capabilities.
 */
export const pageOncallSustainedDegradation: AutomationTemplateInput = {
  id: "page-oncall-sustained-degradation",
  name: "Page on-call on sustained degradation",
  description:
    "Pages an on-call user only when a system stays degraded continuously for 5 minutes. Transient blips that recover within the dwell window do not trigger a page.",
  category: "Alerting",
  icon: "BellRing",
  definition: {
    name: "Page on-call on sustained degradation",
    description:
      "Notify an on-call user when a system has been degraded continuously for 5 minutes, so short-lived blips do not page anyone.",
    triggers: [{ event: "healthcheck.system_degraded", for: { minutes: 5 } }],
    conditions: [],
    actions: [
      {
        id: "page_oncall",
        action: "automation.notify_user",
        config: {
          userId: "REPLACE_USER",
          title: "System {{ trigger.payload.systemName }} degraded for 5+ minutes",
          body: '{{ trigger.payload.systemName }} has been in status "{{ trigger.payload.newStatus }}" continuously for over 5 minutes (was "{{ trigger.payload.previousStatus }}"). This is a sustained degradation, not a transient blip. Investigate now.',
          importance: "critical",
        },
      },
    ],
  },
};
