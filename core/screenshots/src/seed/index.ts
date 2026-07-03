import { onboardAndAuthenticate } from "./client.ts";
import { seedEntities } from "./entities.ts";
import { seedHistory } from "./history.ts";
import { desc, eq } from "drizzle-orm";
import { seedAiChat, AI_CHAT_TITLE } from "./ai-chat.ts";
import { seedNotificationInbox } from "./notifications-inbox.ts";
import { createSeedDb, schema } from "./db.ts";
import type { SeedRefs } from "./types.ts";

/**
 * Seed the running instance end to end: create every entity through the API,
 * then write the historic time-series straight into the database. Returns the
 * ids the capturer needs for deep-link routes.
 */
export async function seed({
  databaseUrl,
}: {
  databaseUrl: string;
}): Promise<SeedRefs> {
   
  console.log("  onboarding admin + creating entities...");
  const client = await onboardAndAuthenticate();
  const result = await seedEntities({ client });

   
  console.log("  writing historic runs / aggregates / SLO / anomaly data...");
  const { db, close } = createSeedDb({ databaseUrl });
  try {
    await seedHistory({ db, checks: result.checks, slos: result.slos });
    await seedAiChat({
      db,
      userId: result.adminUserId,
      integrationId: result.aiIntegration.integrationId,
      model: result.aiIntegration.model,
      title: AI_CHAT_TITLE,
    });
    await seedNotificationInbox({
      db,
      userId: result.adminUserId,
      notificationSystems: result.notificationSystems,
    });

    // Checks were created DISABLED so no live probe was scheduled against the
    // fake hosts (which would crash the backend). Flip them on directly in the
    // DB so the UI shows enabled checks; scheduling only happens via the
    // create/enable RPC path, so a plain column update never enqueues a run.
    await db.update(schema.systemHealthChecks).set({ enabled: true });

    // The most-recent synthesized run for the flagship check, so the capturer
    // can deep-link the run-history detail into a run-selected state.
    const [latestRun] = await db
      .select({ id: schema.healthCheckRuns.id })
      .from(schema.healthCheckRuns)
      .where(
        eq(schema.healthCheckRuns.configurationId, result.refs.configurationId),
      )
      .orderBy(desc(schema.healthCheckRuns.timestamp))
      .limit(1);
    if (!latestRun) {
      throw new Error("Seed invariant broken: no runs for the flagship check");
    }
    return { ...result.refs, historyRunId: latestRun.id };
  } finally {
    await close();
  }
}
