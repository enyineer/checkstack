import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { CacheApi } from "@checkstack/cache-common";
import {
  cn,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ResponsiveTable,
  MobileCardList,
  formatBytes,
} from "@checkstack/ui";
import {
  classifyTtlUrgency,
  maxByteSize,
  sizeBarWidthPercent,
  type TtlTone,
} from "./cacheDisplay.logic";

const REFRESH_INTERVAL_MS = 5000;
const PAGE_SIZE = 25;

type SortBy = "biggest" | "newest";

const formatSize = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : formatBytes(n);

const truncateMiddle = (s: string, head = 18, tail = 10) => {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const formatTtl = (expiresAt: Date | null | undefined) => {
  if (!expiresAt) return "—";
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return "expired";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
};

/** Text-tone classes for the TTL cell, by urgency. */
const ttlToneClass: Record<TtlTone, string> = {
  down: "text-status-down",
  warn: "text-status-warn",
  neutral: "text-muted-foreground",
};

const KEY_CHIP =
  "rounded bg-surface-inset px-1.5 py-0.5 font-mono text-xs";

export const CacheEntriesTable = ({ sortBy }: { sortBy: SortBy }) => {
  const cacheClient = usePluginClient(CacheApi);
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, error } = cacheClient.listEntries.useQuery(
    { offset, limit: PAGE_SIZE, sortBy },
    { refetchInterval: REFRESH_INTERVAL_MS },
  );

  if (error) {
    return (
      <p className="text-sm text-destructive">Failed to load cache entries.</p>
    );
  }
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (data && !data.supported) {
    return (
      <p className="text-sm text-muted-foreground">
        Listing not supported by this cache backend.
      </p>
    );
  }
  if (!data || data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No cache entries.</p>;
  }

  const totalPages =
    data.total === null
      ? data.hasMore
        ? page + 1
        : page
      : Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const showSizeBar = sortBy === "biggest";
  const pageMaxBytes = maxByteSize({ entries: data.items });

  return (
    <div className="space-y-3">
      <ResponsiveTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Key
              </TableHead>
              <TableHead className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Size
              </TableHead>
              <TableHead className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                TTL
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((entry) => {
              const ttlTone = classifyTtlUrgency({
                expiresAt: entry.expiresAt,
              });
              const barWidth = showSizeBar
                ? sizeBarWidthPercent({
                    byteSize: entry.byteSize,
                    maxByteSize: pageMaxBytes,
                  })
                : null;
              return (
                <TableRow
                  key={entry.key}
                  className="transition-colors hover:bg-surface-inset"
                >
                  <TableCell className="whitespace-nowrap" title={entry.key}>
                    <span className={KEY_CHIP}>
                      {truncateMiddle(entry.key)}
                    </span>
                  </TableCell>
                  <TableCell className="relative text-right tabular-nums">
                    {barWidth !== null && (
                      <span
                        className="absolute inset-y-1 right-0 rounded-sm bg-status-ok/15"
                        style={{ width: `${barWidth}%` }}
                        aria-hidden
                      />
                    )}
                    <span className="relative">{formatSize(entry.byteSize)}</span>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      ttlToneClass[ttlTone],
                    )}
                  >
                    {formatTtl(entry.expiresAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ResponsiveTable>

      <MobileCardList>
        {data.items.map((entry) => {
          const ttlTone = classifyTtlUrgency({ expiresAt: entry.expiresAt });
          return (
            <div
              key={entry.key}
              className="group rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-3 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5"
            >
              <div className="break-all" title={entry.key}>
                <span className={KEY_CHIP}>{truncateMiddle(entry.key)}</span>
              </div>
              <div className="mt-3 flex items-center gap-6">
                <div>
                  <div className="text-sm font-semibold tabular-nums">
                    {formatSize(entry.byteSize)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Size
                  </div>
                </div>
                <div>
                  <div
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      ttlToneClass[ttlTone],
                    )}
                  >
                    {formatTtl(entry.expiresAt)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    TTL
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </MobileCardList>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        total={data.total ?? undefined}
        showTotal={data.total !== null}
      />
    </div>
  );
};
