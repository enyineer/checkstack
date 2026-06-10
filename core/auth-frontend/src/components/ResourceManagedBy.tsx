import React from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  LoadingSpinner,
} from "@checkstack/ui";
import { Globe, Lock, Users2, ChevronDown } from "lucide-react";
import {
  useApi,
  usePluginClient,
  accessApiRef,
} from "@checkstack/frontend-api";
import { AuthApi, authAccess } from "@checkstack/auth-common";
import { deriveTeamAccessSummary } from "../lib/deriveTeamAccessSummary";

export interface ResourceManagedByProps {
  /** Qualified resource type, e.g. "catalog.system". */
  resourceType: string;
  resourceId: string;
}

interface TeamAccess {
  teamId: string;
  teamName: string;
  canRead: boolean;
  canManage: boolean;
}

/**
 * Lists a team's members by name. One `getTeam` query per instance (so the
 * parent can render one per managing team without a hooks-in-loop violation).
 */
const TeamMemberList: React.FC<{ teamId: string; teamName: string }> = ({
  teamId,
  teamName,
}) => {
  const authClient = usePluginClient(AuthApi);
  const { data, isLoading, isError } = authClient.getTeam.useQuery({ teamId });

  const members = data?.members ?? [];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Users2 className="h-3 w-3 text-muted-foreground" />
        {teamName}
      </div>
      {isLoading ? (
        <div className="pl-4 text-xs text-muted-foreground">
          <LoadingSpinner />
        </div>
      ) : isError ? (
        <p className="pl-4 text-xs text-destructive">
          Couldn&apos;t load members.
        </p>
      ) : members.length === 0 ? (
        <p className="pl-4 text-xs italic text-muted-foreground">
          No members.
        </p>
      ) : (
        <ul className="space-y-0.5 pl-4">
          {members.map((m) => (
            <li key={m.id} className="text-xs text-muted-foreground">
              {m.name}{" "}
              <span className="text-[10px] opacity-70">{m.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * Read-only "who can change this" indicator for a resource detail page. Shows
 * which team(s) manage the resource (or that it is private), and expands to the
 * actual people by name so a viewer knows who to ask. Renders NOTHING when the
 * resource is not team-scoped (the common case — avoids noise), when the viewer
 * lacks `auth.teams.read`, or on load/error (a passive viewer takes no action,
 * so it degrades silently). Reuses `deriveTeamAccessSummary` so its semantics
 * match the edit-mode "Who can change this" editor exactly.
 */
export const ResourceManagedBy: React.FC<ResourceManagedByProps> = ({
  resourceType,
  resourceId,
}) => {
  const accessApi = useApi(accessApiRef);
  const authClient = usePluginClient(AuthApi);
  const { allowed: canReadTeams } = accessApi.useAccess(authAccess.teams.read);

  const {
    data: relations,
    isError,
  } = authClient.listObjectRelations.useQuery(
    { objectType: resourceType, objectId: resourceId },
    { enabled: canReadTeams && !!resourceId },
  );

  if (!canReadTeams) return null;
  // On a fetch error, say so rather than rendering nothing — otherwise a private
  // resource would silently look unscoped/open to the viewer.
  if (isError) {
    return (
      <p className="text-xs text-muted-foreground">Access info unavailable.</p>
    );
  }
  // Still loading (or no data yet): render nothing (avoids a flash).
  if (!relations) return null;

  // Map the relation tuples to the read/manage shape the rest of this
  // component (and the shared summary helper) expects: any relation grants
  // read; everything above `viewer` (editor/owner) also grants manage.
  const typedAccess: TeamAccess[] = relations.teams.map((t) => ({
    teamId: t.teamId,
    teamName: t.teamName,
    canRead: true,
    canManage: t.relation !== "viewer",
  }));
  const teamOnly = !relations.isPublic;
  const summary = deriveTeamAccessSummary({
    accessList: typedAccess,
    teamOnly,
  });

  // Only render when there is something meaningful to say.
  if (summary.kind === "open" || summary.kind === "readonly-grants") {
    return null;
  }

  const isPrivate = summary.kind === "private";
  // The teams whose people actually govern this resource: for a private
  // resource, anyone with a grant; otherwise the managers.
  const relevantTeams = typedAccess.filter((a) =>
    isPrivate ? a.canRead || a.canManage : a.canManage,
  );
  const teamNames = relevantTeams.map((t) => t.teamName);
  const Icon = isPrivate ? Lock : Globe;
  const label = isPrivate
    ? `Private to ${teamNames.join(", ")}`
    : `Managed by ${teamNames.join(", ")}`;
  // Always-visible explanation (the old hover-only Tooltip was inaccessible to
  // keyboard + touch users on what is the viewer's main "who do I ask?" cue).
  const explanation = isPrivate
    ? "Only these teams can view or change this."
    : "Anyone with read access can view this. These teams can change it.";

  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Access
      </h3>
      <div className="flex items-center gap-1.5 text-sm text-foreground">
        <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <span>{label}</span>
        {relevantTeams.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded text-xs text-muted-foreground underline-offset-2 hover:underline"
                aria-label="Show who can change this, by name"
              >
                who?
                <ChevronDown className="h-3 w-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2">
              <p className="text-xs font-medium">
                {isPrivate ? "People with access" : "People who can change this"}
              </p>
              {relevantTeams.map((t) => (
                <TeamMemberList
                  key={t.teamId}
                  teamId={t.teamId}
                  teamName={t.teamName}
                />
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{explanation}</p>
    </div>
  );
};
