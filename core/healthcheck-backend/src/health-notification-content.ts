import { resolveRoute, type InferClient } from "@checkstack/common";
import { catalogRoutes, createSystemSubject } from "@checkstack/catalog-common";
import type { NotificationApi } from "@checkstack/notification-common";
import {
  createHealthcheckSubject,
  healthcheckRoutes,
  systemHealthCollapseKey,
  healthcheckSystemSubscription,
  type HealthCheckStatus,
} from "@checkstack/healthcheck-common";
import type { TransitionKind } from "./notification-policy";

/** The subset of `notifyForSubscription`'s input this builder produces. */
type NotifyForSubscriptionInput = Parameters<
  InferClient<typeof NotificationApi>["notifyForSubscription"]
>[0];

/**
 * Inputs to {@link buildHealthTransitionNotification}. Pure data only - the
 * catalog client is unused here (parents are resolved server-side) and thus
 * omitted; every field is derived before the call site in the queue executor.
 */
export interface HealthTransitionNotificationInput {
  transition: Exclude<TransitionKind, "none">;
  systemId: string;
  systemName: string;
  configurationId: string;
  /** Resolved display name of the check that drove the transition. */
  checkName: string;
  newStatus: HealthCheckStatus;
  /** Concrete env id for a per-env slice, null/undefined for the system rollup. */
  environmentId?: string | null;
  /** Human-readable env name for the body/title. */
  environmentName?: string;
}

/**
 * Build the notification payload for a health-state transition. Pure and
 * side-effect free so it can be unit-tested directly. Extracted from
 * `notifyStateChange` so the body/title/subject wording (which now NAMES the
 * failing check and pushes a `healthcheck.healthcheck` subject) is verifiable
 * without booting the whole queue executor.
 *
 * Recovery bodies stay system-level (the whole system is green again; naming
 * one check would mislead) and omit the check subject. Failing transitions
 * (escalation / de-escalation) name the check in the body and add it as a
 * subject deep-linked to its run history.
 */
export function buildHealthTransitionNotification(
  input: HealthTransitionNotificationInput,
): NotifyForSubscriptionInput {
  const {
    transition,
    systemId,
    systemName,
    configurationId,
    checkName,
    newStatus,
    environmentId,
    environmentName,
  } = input;

  const envScoped = typeof environmentId === "string";
  const envSuffix = envScoped && environmentName ? ` (${environmentName})` : "";
  const envQualifier = envScoped
    ? ` in environment **${environmentName ?? environmentId}**`
    : "";

  let title: string;
  let body: string;
  let importance: "info" | "warning" | "critical";

  if (transition === "recovery") {
    title = `System health restored${envSuffix}: ${systemName}`;
    body = envScoped
      ? `Health checks for **${systemName}** in environment **${environmentName ?? environmentId}** are now passing. The system has returned to normal operation in that environment.`
      : `All health checks for **${systemName}** are now passing. The system has returned to normal operation.`;
    importance = "info";
  } else if (newStatus === "unhealthy") {
    title = `System health critical${envSuffix}: ${systemName}`;
    body = `Health check **"${checkName}"** on **${systemName}**${envQualifier} is failing. The system is unhealthy and may be down${envScoped ? " in that environment" : ""}.`;
    importance = "critical";
  } else {
    // degraded - either an escalation from healthy or a partial recovery
    title = `System health degraded${envSuffix}: ${systemName}`;
    body = `Health check **"${checkName}"** on **${systemName}**${envQualifier} is failing. The system may be experiencing issues${envScoped ? " in that environment" : ""}.`;
    importance = "warning";
  }

  const systemDetailPath = resolveRoute(catalogRoutes.routes.systemDetail, {
    systemId,
  });
  // Recovery lands on the default (all) view; failing transitions deep-link
  // operators into the failing-checks filter so they can debug immediately.
  const actionUrl =
    transition === "recovery"
      ? systemDetailPath
      : `${systemDetailPath}?filter=failing`;
  const actionLabel =
    transition === "recovery" ? "View System" : "View failing checks";

  return {
    specId: healthcheckSystemSubscription.specId,
    resourceKeys: [systemId],
    title,
    body,
    importance,
    action: { label: actionLabel, url: actionUrl },
    // Env-qualified collapse key so two failing envs of one system generate
    // two independent notification cards (one per env) instead of merging.
    collapseKey: envScoped
      ? systemHealthCollapseKey(systemId, environmentId)
      : systemHealthCollapseKey(systemId),
    subjects: [
      createSystemSubject({
        id: systemId,
        name: systemName,
        url: systemDetailPath,
        status: newStatus,
      }),
      // Name the failing check as its own subject for every non-recovery
      // transition, deep-linked to its run history. Omitted on recovery.
      ...(transition === "recovery"
        ? []
        : [
            createHealthcheckSubject({
              id: configurationId,
              name: checkName,
              url: resolveRoute(healthcheckRoutes.routes.historyDetail, {
                systemId,
                configurationId,
              }),
              status: newStatus,
            }),
          ]),
    ],
  };
}
