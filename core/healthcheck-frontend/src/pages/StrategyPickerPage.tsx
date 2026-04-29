import { useState, useMemo } from "react";
import {
  usePluginClient,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import { HealthCheckApi } from "../api";
import {
  healthcheckRoutes,
  STRATEGY_CATEGORY_META,
  type StrategyCategory,
  type HealthCheckStrategyDto,
} from "@checkstack/healthcheck-common";
import {
  PageLayout,
  Input,
  Badge,
} from "@checkstack/ui";
import { Search, Zap } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resolveRoute } from "@checkstack/common";

/**
 * Card component for a single strategy in the picker grid.
 */
function StrategyCard({
  strategy,
  onSelect,
}: {
  strategy: HealthCheckStrategyDto;
  onSelect: (strategy: HealthCheckStrategyDto) => void;
}) {
  const categoryMeta = STRATEGY_CATEGORY_META[strategy.category];

  return (
    <button
      type="button"
      onClick={() => onSelect(strategy)}
      className="group flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md hover:shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex w-full items-center justify-between">
        <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
          {strategy.displayName}
        </h3>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {categoryMeta?.label ?? strategy.category}
        </Badge>
      </div>
      {strategy.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {strategy.description}
        </p>
      )}
    </button>
  );
}

/**
 * Strategy Picker Page — full-page card grid grouped by category.
 * Acts as the first step of the "Create Health Check" wizard flow.
 */
const StrategyPickerPageContent = () => {
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const systemIdFromUrl = urlParams.get("systemId");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: strategies = [] } = healthCheckClient.getStrategies.useQuery(
    {},
  );

  // Group strategies by category and filter by search
  const groupedStrategies = useMemo(() => {
    const filtered = strategies.filter((s) => {
      const query = searchQuery.toLowerCase();
      if (!query) return true;
      return (
        s.displayName.toLowerCase().includes(query) ||
        (s.description?.toLowerCase().includes(query) ?? false)
      );
    });

    // Group by category
    const groups = new Map<StrategyCategory, HealthCheckStrategyDto[]>();
    for (const strategy of filtered) {
      const category = strategy.category;
      const existing = groups.get(category) ?? [];
      existing.push(strategy);
      groups.set(category, existing);
    }

    // Sort groups by category sort order
    return [...groups.entries()].toSorted(([a], [b]) => {
      const orderA = STRATEGY_CATEGORY_META[a]?.sortOrder ?? 99;
      const orderB = STRATEGY_CATEGORY_META[b]?.sortOrder ?? 99;
      return orderA - orderB;
    });
  }, [strategies, searchQuery]);

  const handleSelectStrategy = (strategy: HealthCheckStrategyDto) => {
    const params = new URLSearchParams();
    params.set("strategy", strategy.id);
    if (systemIdFromUrl) {
      params.set("systemId", systemIdFromUrl);
    }
    navigate(
      `${resolveRoute(healthcheckRoutes.routes.edit, { configId: "new" })}?${params.toString()}`,
    );
  };

  return (
    <PageLayout
      title="Create Health Check"
      subtitle="Choose a strategy to get started"
      icon={Zap}
      actions={
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search strategies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      }
    >
      {groupedStrategies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Search className="h-8 w-8 mb-3 opacity-40" />
          <p className="text-sm">
            {searchQuery
              ? "No strategies match your search."
              : "No strategies available."}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedStrategies.map(([category, categoryStrategies]) => {
            const meta = STRATEGY_CATEGORY_META[category];
            return (
              <section key={category}>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {meta?.label ?? category}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categoryStrategies.map((strategy) => (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      onSelect={handleSelectStrategy}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
};

export const StrategyPickerPage = wrapInSuspense(StrategyPickerPageContent);
