import { useState, useEffect } from "react";
import { Info, Github, Mail, Scale, ExternalLink, Package } from "lucide-react";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  LoadingSpinner,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";

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
 * Returns a badge variant for a plugin type.
 */
function typeBadgeVariant(type: string): "default" | "secondary" | "info" {
  switch (type) {
    case "backend": {
      return "default";
    }
    case "frontend": {
      return "info";
    }
    default: {
      return "secondary";
    }
  }
}

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
        setError(
          extractErrorMessage(error, "Failed to load about info"),
        );
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
      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-primary/10 p-3">
              <Package className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-xl">Checkstack</CardTitle>
              <CardDescription className="text-base">
                The Modern Status Page &amp; Monitoring Platform
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Monitor your systems, keep users informed, and maintain trust.
            Checkstack combines the power of a status page, uptime monitoring,
            and incident management into a single, extensible platform.
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            <a
              href="https://github.com/enyineer/checkstack"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              <Github className="h-4 w-4" />
              GitHub Repository
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
            <a
              href="mailto:hi@enking.dev"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              <Mail className="h-4 w-4" />
              hi@enking.dev
            </a>
          </div>
        </CardContent>
      </Card>

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
            <div className="rounded-lg bg-success/5 border border-success/20 p-4">
              <h4 className="text-sm font-semibold text-success mb-2">
                ✅ Allowed
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Internal company use</li>
                <li>Personal projects</li>
                <li>Research &amp; education</li>
                <li>Modification &amp; redistribution</li>
                <li>Building applications on top</li>
              </ul>
            </div>
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4">
              <h4 className="text-sm font-semibold text-destructive mb-2">
                ❌ Not Allowed
              </h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Selling as a managed SaaS</li>
                <li>Removing license protections</li>
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
              {/* Core Version */}
              <div className="flex items-center justify-between rounded-lg bg-secondary/50 border border-border p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Checkstack Core
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Backend platform engine
                  </p>
                </div>
                <Badge variant="default" className="font-mono text-xs">
                  v{aboutInfo.coreVersion}
                </Badge>
              </div>

              {/* Plugin Versions Table */}
              {aboutInfo.plugins.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-3">
                    Loaded Plugins ({aboutInfo.plugins.length})
                  </h4>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">
                            Plugin
                          </th>
                          <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">
                            Type
                          </th>
                          <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">
                            Version
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {aboutInfo.plugins.map((plugin) => (
                          <tr
                            key={plugin.name}
                            className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                          >
                            <td className="py-2.5 px-4">
                              <span className="font-medium text-foreground">
                                {formatPluginName(plugin.name)}
                              </span>
                              <span className="block text-xs text-muted-foreground font-mono">
                                {plugin.name}
                              </span>
                            </td>
                            <td className="py-2.5 px-4">
                              <Badge
                                variant={typeBadgeVariant(plugin.type)}
                                className="text-[10px]"
                              >
                                {plugin.type}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-muted-foreground">
                              {plugin.version}
                            </td>
                          </tr>
                        ))}
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
