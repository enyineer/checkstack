import type { AutomationTemplateInput } from "@checkstack/automation-common";
import { aiTriageFileJiraBug } from "./ai-triage-file-jira-bug";
import { pageOncallSustainedDegradation } from "./page-oncall-sustained-degradation";
import { jiraCommentTransitionOnRecovery } from "./jira-comment-transition-on-recovery";
import { aiSummarizeNewIncident } from "./ai-summarize-new-incident";
import { aiSeverityEscalation } from "./ai-severity-escalation";

/**
 * Built-in example-automation templates shipped by automation-backend.
 *
 * Each template references action / trigger / artifact ids by string (including
 * ids owned by other plugins, e.g. `integration-jira.create_issue`). The
 * startup validator (`validate-templates.ts`) skips any template whose
 * capabilities are not installed on this instance, and withholds (with a loud
 * error) any whose definition no longer validates against the live registries.
 *
 * One file per template, re-exported here.
 */
export const builtinAutomationTemplates: AutomationTemplateInput[] = [
  aiTriageFileJiraBug,
  pageOncallSustainedDegradation,
  jiraCommentTransitionOnRecovery,
  aiSummarizeNewIncident,
  aiSeverityEscalation,
];
