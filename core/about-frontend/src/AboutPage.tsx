import { useState, useEffect } from "react";
import { Info, Scale } from "lucide-react";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  LoadingSpinner,
  cn,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";
import { AboutHero } from "./AboutHero";
import { pluginTypeChipStyle } from "./pluginTypeChip.logic";

interface PluginInfo {
  name: string;
  version: string;
  type: "backend" | "frontend" | "common";
}

interface AboutInfo {
  coreVersion: string;
  plugins: PluginInfo[];
}

/**
 * Formats a raw package name for display.
 * Strips `@checkstack/` prefix and converts to title case.
 * e.g., "@checkstack/healthcheck-http-backend" → "Healthcheck HTTP"
 */
function formatPluginName(name: string): string {
  const stripped = name.replace("@checkstack/", "");
  // Remove type suffixes (-backend, -frontend, -common)
  const withoutSuffix = stripped
    .replace(/-backend$/, "")
    .replace(/-frontend$/, "")
    .replace(/-common$/, "");
  // Title case with dashes as spaces
  return withoutSuffix
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The shared depth base for the elevated inner panels (core version, license
 * status panels): gradient surface, soft layered shadow, hairline border.
 */
const PANEL_BASE =
  "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

export function AboutPage() {
  const [aboutInfo, setAboutInfo] = useState<AboutInfo | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const fetchAboutInfo = async () => {
      try {
        const response = await fetch("/api/about");
        if (!response.ok) {
          throw new Error(`Failed to fetch about info: ${response.status}`);
        }
        const data = (await response.json()) as AboutInfo;
        setAboutInfo(data);
      } catch (error) {
        setError(extractErrorMessage(error, "Failed to load about info"));
      } finally {
        setLoading(false);
      }
    };

    void fetchAboutInfo();
  }, []);

  return (
    <PageLayout
      title="About Checkstack"
      icon={Info}
      subtitle="Platform information, license, and version details"
    >
      {/* Hero Section */}
      <AboutHero />

      {/* License Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Scale className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">License</CardTitle>
          </div>
          <CardDescription>
            Checkstack is licensed under the{" "}
            <strong className="text-foreground">
              Elastic License 2.0 (ELv2)
            </strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Allowed panel: multi-encoded via stripe + dot + hue + position. */}
            <div
              className={cn(
                PANEL_BASE,
                "border-status-ok/20 bg-status-ok/5 pl-5",
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1 bg-status-ok"
              />
              <div className="inline-flex items-center gap-1.5 rounded-full bg-status-ok/10 px-2.5 py-1 text-status-ok">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-status-ok"
                />
                <h4 className="text-sm font-semibold text-status-ok">
                  ✅ Allowed
                </h4>
              </div>
              <ul className="mt-3 divide-y divide-border/60 text-sm text-muted-foreground">
                <li className="py-1.5 first:pt-0">Internal company use</li>
                <li className="py-1.5">Personal projects</li>
                <li className="py-1.5">Research &amp; education</li>
                <li className="py-1.5">Modification &amp; redistribution</li>
                <li className="py-1.5 last:pb-0">
                  Building applications on top
                </li>
              </ul>
            </div>
            {/* Not-allowed panel: stripe + dot + hue + position. */}
            <div
              className={cn(
                PANEL_BASE,
                "border-status-down/20 bg-status-down/5 pl-5",
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1 bg-status-down"
              />
              <div className="inline-flex items-center gap-1.5 rounded-full bg-status-down/10 px-2.5 py-1 text-status-down">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-status-down"
                />
                <h4 className="text-sm font-semibold text-status-down">
                  ❌ Not Allowed
                </h4>
              </div>
              <ul className="mt-3 divide-y divide-border/60 text-sm text-muted-foreground">
                <li className="py-1.5 first:pt-0">Selling as a managed SaaS</li>
                <li className="py-1.5 last:pb-0">
                  Removing license protections
                </li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Need a commercial license to provide Checkstack as a managed / SaaS
            service?{" "}
            <a
              href="mailto:hi@enking.dev"
              className="text-primary hover:underline"
            >
              Contact us
            </a>
          </p>
        </CardContent>
      </Card>

      {/* Version Information Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Info className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Version Information</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex justify-center py-6">
              <LoadingSpinner />
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {aboutInfo && (
            <div className="space-y-6">
              {/* Core Version: number-led stat panel with a health accent. */}
              <div className={cn(PANEL_BASE, "pl-5")}>
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-1 bg-status-ok"
                />
                <p className="text-3xl font-bold tabular-nums leading-none text-foreground">
                  v{aboutInfo.coreVersion}
                </p>
                <div className="mt-2">
                  <p className="text-xs font-medium text-foreground">
                    Checkstack Core
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Backend platform engine
                  </p>
                </div>
              </div>

              {/* Plugin Versions Table */}
              {aboutInfo.plugins.length > 0 && (
                <div>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <h4 className="text-sm font-medium text-foreground">
                      Loaded Plugins ({aboutInfo.plugins.length})
                    </h4>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {aboutInfo.plugins.length} loaded
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-[var(--d-card-r)] border border-border/60">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/60 bg-surface-2">
                          <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Plugin
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Type
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Version
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {aboutInfo.plugins.map((plugin) => {
                          const chip = pluginTypeChipStyle(plugin.type);
                          return (
                            <tr
                              key={plugin.name}
                              className="transition-colors hover:bg-surface-inset"
                            >
                              <td className="px-4 py-2.5">
                                <span className="font-medium text-foreground">
                                  {formatPluginName(plugin.name)}
                                </span>
                                <span className="block font-mono text-xs text-muted-foreground">
                                  {plugin.name}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                                    chip.pill,
                                  )}
                                >
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "size-1.5 rounded-full",
                                      chip.dot,
                                    )}
                                  />
                                  {plugin.type}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
                                {plugin.version}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer Attribution */}
      <p className="text-center text-xs text-muted-foreground py-4">
        Built with ❤️ for reliability engineers everywhere
      </p>
    </PageLayout>
  );
}
