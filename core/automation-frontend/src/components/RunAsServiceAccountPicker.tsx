import React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi, authRoutes } from "@checkstack/auth-common";
import { resolveRoute, APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertIcon,
  AlertContent,
  AlertDescription,
  EmptyState,
  Button,
} from "@checkstack/ui";

/**
 * Deep-links into the in-app user guide. The backend serves the Astro Starlight
 * docs build same-origin at `/checkstack/*`, so these are same-origin paths
 * opened in a new tab. They are static doc pages, not app routes - hence a plain
 * anchor (below), never a react-router `<Link>`. Slugs are centralised in
 * `APP_DOC_SLUGS` and guarded by `docs-links.test.ts` against renames.
 */
const DOCS_TEAMS_AND_ACCESS = docsPath(APP_DOC_SLUGS.teamsAndAccess);
const DOCS_SERVICE_ACCOUNTS = docsPath(APP_DOC_SLUGS.apiKeys);

/** Route to the Applications admin tab in auth settings. */
const APPLICATIONS_ADMIN_ROUTE = `${resolveRoute(
  authRoutes.routes.settings,
)}?tab=applications`;

export interface RunAsServiceAccountPickerProps {
  /** Selected application id, or empty string when nothing is chosen yet. */
  value: string;
  /** Called with the chosen application id. */
  onValueChange: (next: string) => void;
  /** When false, the picker is read-only (matches the page's `canManage`). */
  disabled?: boolean;
  /** Show the inline "required" validation hint. */
  showError?: boolean;
}

/**
 * "Run as (Service Account)" picker for the automation editor.
 *
 * Populated from the auth plugin's `getBindableApplications` query, which
 * server-side filters to exactly the applications THIS user is allowed to
 * bind (their access rules are a subset of the caller's). The automation
 * then runs with the chosen application's permissions, so picking one is
 * required.
 *
 * Teaching UX:
 *   - An info banner explains what a service account is and why it is
 *     required.
 *   - When no applications are bindable, an `EmptyState` points the user to
 *     the Applications admin and the docs instead of leaving them stuck.
 */
export const RunAsServiceAccountPicker: React.FC<
  RunAsServiceAccountPickerProps
> = ({ value, onValueChange, disabled, showError }) => {
  const authClient = usePluginClient(AuthApi);
  const { data: applications = [], isLoading } =
    authClient.getBindableApplications.useQuery({});

  const hasNoApplications = !isLoading && applications.length === 0;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor="runAs">Run as (Service Account)</Label>
        <Select
          value={value || undefined}
          onValueChange={onValueChange}
          disabled={disabled || hasNoApplications || isLoading}
        >
          <SelectTrigger
            id="runAs"
            aria-invalid={showError ? true : undefined}
            className={showError ? "border-destructive" : undefined}
          >
            <SelectValue
              placeholder={
                isLoading ? "Loading service accounts..." : "Select a service account"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {applications.map((app) => (
              <SelectItem key={app.id} value={app.id}>
                <span className="flex flex-col text-left">
                  <span className="truncate">{app.name}</span>
                  {app.description ? (
                    <span className="text-xs text-muted-foreground truncate">
                      {app.description}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showError && !hasNoApplications && (
          <p className="text-xs text-destructive">
            A service account is required.
          </p>
        )}
      </div>

      {hasNoApplications ? (
        <EmptyState
          icon={<KeyRound className="h-7 w-7" />}
          title="No service accounts available"
          description={
            <>
              An automation runs with a service account's permissions, but you
              do not have any to bind yet. Create or get access to one in the
              Applications admin, then come back here.
            </>
          }
          actions={
            <>
              <Link to={APPLICATIONS_ADMIN_ROUTE}>
                <Button size="sm" variant="outline">
                  Open Applications admin
                </Button>
              </Link>
              <a
                href={DOCS_SERVICE_ACCOUNTS}
                target="_blank"
                rel="noreferrer"
              >
                <Button size="sm" variant="ghost">
                  Learn more
                  <ExternalLink className="ml-1 h-3.5 w-3.5" />
                </Button>
              </a>
            </>
          }
        />
      ) : (
        <Alert variant="info">
          <AlertIcon>
            <ShieldCheck className="h-4 w-4" />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>
              A service account is an application the automation runs as. It
              executes with that account's permissions (assigned via roles), so
              picking one is required.{" "}
              <a
                href={DOCS_TEAMS_AND_ACCESS}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:no-underline"
              >
                Learn more
                <ExternalLink className="h-3 w-3" />
              </a>
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}
    </div>
  );
};
