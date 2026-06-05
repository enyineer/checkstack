/**
 * Bind-authority predicate for automation service accounts.
 *
 * An automation runs as a referenced application (service account). To prevent
 * privilege escalation, a user may only bind an application whose effective
 * access rules are a SUBSET of their own - a user can never grant an automation
 * more authority than they themselves hold.
 *
 * Rules:
 * - A caller holding `*` (admin) may bind any application.
 * - An application holding `*` may only be bound by a `*`-holding caller.
 * - Otherwise every one of the application's access rules must be present in
 *   the caller's access rules.
 *
 * This is the single source of truth for the check, used both by the auth
 * backend's `getBindableApplications` (the picker) and by the automation
 * backend's create/update handler (the enforced gate at save time).
 */
export function isApplicationBindable({
  appAccessRules,
  callerAccessRules,
}: {
  appAccessRules: readonly string[];
  callerAccessRules: readonly string[];
}): boolean {
  if (callerAccessRules.includes("*")) return true;
  if (appAccessRules.includes("*")) return false;
  const caller = new Set(callerAccessRules);
  return appAccessRules.every((rule) => caller.has(rule));
}
