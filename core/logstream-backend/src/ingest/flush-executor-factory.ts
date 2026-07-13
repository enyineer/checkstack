/**
 * Chooses and builds the ingest {@link FlushExecutor} for a pod (plan §5, Phase
 * D). The offloadable flush stage runs either:
 *
 * - IN-PROCESS on the main thread's shared Drain tree - the pre-Phase-D behavior,
 *   selected by `CHECKSTACK_LOGSTREAM_INGEST_WORKERS=0`; or
 * - on a stream-sharded WORKER POOL of the configured size (default 1), which
 *   moves classify + fold + sample off the main thread while the in-process
 *   executor stays wired as the crash/degradation fallback.
 *
 * Constructing the pool is best-effort: if a worker cannot even be spawned (an
 * environment without worker support), we log and fall back to the in-process
 * executor so ingestion still runs. This keeps a misconfiguration from taking
 * ingest down.
 */

import { z } from "zod";
import type { Logger } from "@checkstack/backend-api";
import type { DrainEngine } from "../drain/engine";
import type { Storage } from "../storage";
import {
  createInProcessFlushExecutor,
  type FlushExecutor,
} from "./flush-executor";
import { createWorkerFlushExecutor } from "./worker/pool";
import { createDbPatternLoader } from "./worker/db-loader";

/** Env var selecting the ingest worker-pool size (0 = in-process). */
export const INGEST_WORKERS_ENV = "CHECKSTACK_LOGSTREAM_INGEST_WORKERS";

/** Default worker count when the env var is unset or malformed. */
const DEFAULT_INGEST_WORKERS = 1;

const WorkerCountSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(64)
  .default(DEFAULT_INGEST_WORKERS);

/**
 * Resolve the configured ingest worker count. Default 1 (a single worker, tree
 * convergence identical to the in-process path). `0` keeps the flush stage on the
 * main thread. A malformed value falls back to the default rather than failing
 * boot.
 */
export function resolveIngestWorkerCount(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = WorkerCountSchema.safeParse(env[INGEST_WORKERS_ENV]);
  return parsed.success ? parsed.data : DEFAULT_INGEST_WORKERS;
}

/**
 * Build the pod's flush executor. Always constructs the in-process executor (it
 * backs both the workers-disabled path and the worker pool's fallback); wraps it
 * in a worker pool when a positive worker count is configured.
 */
export function createFlushExecutor({
  drain,
  storage,
  logger,
  rng,
  env = process.env,
}: {
  drain: DrainEngine;
  storage: Storage;
  logger: Logger;
  rng?: () => number;
  env?: NodeJS.ProcessEnv;
}): FlushExecutor {
  const inProcess = createInProcessFlushExecutor({ drain, logger, rng });
  const poolSize = resolveIngestWorkerCount(env);

  if (poolSize < 1) {
    logger.debug("logstream: ingest workers disabled (running flush in-process)");
    return inProcess;
  }

  try {
    const executor = createWorkerFlushExecutor({
      poolSize,
      loadPatternRows: createDbPatternLoader({ storage, logger }),
      fallback: inProcess,
      logger,
    });
    logger.debug(`logstream: ingest flush offloaded to ${poolSize} worker(s)`);
    return executor;
  } catch (error) {
    logger.warn(
      `logstream: could not start ingest worker pool, falling back to in-process flush: ${String(error)}`,
    );
    return inProcess;
  }
}
