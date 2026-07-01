import React, { useEffect } from "react";
import {
  Label,
  LoadingSpinner,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import { Users2, AlertCircle } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";

/** Sentinel select value for "no owning team" (global resource). */
const GLOBAL_VALUE = "__global__";

export interface TeamOwnershipPickerProps {
  /** Selected owning team id, or `null` for a global/un-owned resource. */
  value: string | null;
  /** Called with the chosen team id, or `null` for global. */
  onChange: (teamId: string | null) => void;
  /**
   * Whether the caller may create a GLOBAL (un-owned) resource — i.e. they hold
   * the resource's global `manage` rule. When true the picker offers a
   * "No team (global)" option and selection is optional; when false the caller
   * must pick one of their teams (the server enforces this too).
   */
  allowGlobal: boolean;
  /** Field label. Defaults to "Owning team". */
  label?: string;
  /** Inline error (e.g. from a failed create: must pick a team / not allowed). */
  error?: string | null;
  /**
   * For parent-gated resources (e.g. an incident "for" systems), restrict the
   * options to the caller's teams that MANAGE all of these parent resources.
   * Provide both the qualified parent type and the selected ids; the picker
   * resolves the eligible teams itself and clears a now-ineligible selection.
   */
  parentResourceType?: string;
  parentResourceIds?: string[];
  disabled?: boolean;
}

/**
 * Create-form picker for the team that will OWN (manage) a newly-created
 * resource. The owning team is auto-granted manage; the resource stays globally
 * readable. Lists the caller's own teams (via `auth.getMyTeams`), optionally
 * restricted to those that manage the selected parent(s), plus a
 * "No team (global)" option when the caller may create globally.
 */
export const TeamOwnershipPicker: React.FC<TeamOwnershipPickerProps> = ({
  value,
  onChange,
  allowGlobal,
  label = "Owning team",
  error,
  parentResourceType,
  parentResourceIds,
  disabled = false,
}) => {
  const authClient = usePluginClient(AuthApi);
  const { data, isLoading } = authClient.getMyTeams.useQuery({});
  const allTeams = data?.teams ?? [];

  // Parent-gated restriction: resolve the caller's teams that manage all the
  // selected parents (e.g. systems for an incident).
  const restricting =
    !!parentResourceType && (parentResourceIds?.length ?? 0) > 0;
  const { data: managing } = authClient.getMyManagingTeams.useQuery(
    {
      resourceType: parentResourceType ?? "",
      resourceIds: parentResourceIds ?? [],
    },
    {
      enabled: restricting,
      // Keep the previous eligible teams visible while re-resolving after the
      // selected systems change, so the picker doesn't collapse to a loading
      // row (which made the modal briefly jump height on first selection).
      placeholderData: (prev) => prev,
    },
  );
  const eligibleIds = restricting ? managing?.teamIds : undefined;
  const teams = eligibleIds
    ? allTeams.filter((t) => eligibleIds.includes(t.id))
    : allTeams;

  // Clear a selection that is no longer eligible (e.g. systems changed).
  useEffect(() => {
    if (eligibleIds && value && !eligibleIds.includes(value)) {
      onChange(null);
    }
  }, [eligibleIds, value, onChange]);

  // When a global (un-owned) resource is NOT allowed, an owning team is
  // required: a resource created with no team would be uneditable by a
  // team-scoped creator afterwards (no team grant, no global rule; the server
  // enforces this too). Auto-select when there's exactly one eligible team so
  // the common case needs no interaction.
  useEffect(() => {
    if (!allowGlobal && !value && teams.length === 1) {
      onChange(teams[0].id);
    }
  }, [allowGlobal, value, teams, onChange]);

  // Only block on the INITIAL teams load. Re-resolving eligible teams after the
  // selected systems change keeps the previous list (see `placeholderData`), so
  // the picker stays mounted instead of flashing this loading row.
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoadingSpinner /> Loading teams...
      </div>
    );
  }

  const restrictedEmpty = restricting && teams.length === 0;

  // No valid team to pick and global creation isn't allowed.
  if (teams.length === 0 && !allowGlobal) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
        {restrictedEmpty
          ? "None of your teams manage the selected system(s)."
          : "You are not a member of any team allowed to create this resource. Ask an admin to add you to one."}
      </p>
    );
  }

  // No teams to choose from, but global creation is allowed: make it explicit.
  // Distinguish the cause — "you belong to no team" vs "your teams don't manage
  // the selected parent" — so the user understands why there's nothing to pick.
  if (teams.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <Users2 className="h-3.5 w-3.5" />
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">
          {restrictedEmpty
            ? "None of your teams manage the selected system(s), so there is no team to assign. This will be created as a global resource."
            : "You are not a member of any team, so there is no team to assign. This will be created as a global resource."}
        </p>
      </div>
    );
  }

  const selectValue = value ?? (allowGlobal ? GLOBAL_VALUE : "");

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <Users2 className="h-3.5 w-3.5" />
        {label}
        {!allowGlobal && (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>
      <Select
        value={selectValue}
        onValueChange={(v) => onChange(v === GLOBAL_VALUE ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue
            placeholder={allowGlobal ? "No team (global)" : "Select a team"}
          />
        </SelectTrigger>
        <SelectContent>
          {allowGlobal && (
            <SelectItem value={GLOBAL_VALUE}>No team (global)</SelectItem>
          )}
          {teams.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        The owning team can change this; everyone who can read it still can.
      </p>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
};
