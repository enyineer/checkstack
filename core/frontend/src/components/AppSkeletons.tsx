import { Skeleton } from "@checkstack/ui";

/**
 * Content-area placeholder shown while a route page chunk loads (and during
 * access checks). It mirrors a typical page's header + body so the app shell
 * stays put and only the content region streams in - no full-page spinner and
 * no layout jump when the real page resolves.
 */
export function PageSkeleton() {
  return (
    <div
      className="flex flex-col gap-6 p-1"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton variant="text" className="w-72 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
      <Skeleton variant="chart" />
    </div>
  );
}

/**
 * Full-screen shell placeholder for the brief window before the providers
 * mount. With the inlined bootstrap this is rarely reached on the admin origin
 * (config is read synchronously); it covers the dev server / a seeded
 * cross-origin baseUrl, where the runtime config is still fetched. Approximates
 * the header + sidebar + content so first paint looks like the app rather than
 * a bare spinner.
 */
export function ShellSkeleton() {
  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-surface"
      role="status"
      aria-busy="true"
      aria-label="Loading Checkstack"
    >
      <div className="flex items-center gap-4 border-b border-border bg-surface-2 p-4">
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-5 w-28" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-60 shrink-0 flex-col gap-2 border-r border-border p-4 md:flex">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <PageSkeleton />
          </div>
        </main>
      </div>
    </div>
  );
}
