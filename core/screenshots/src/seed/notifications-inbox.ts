import { notifications } from "@checkstack/notification-backend/src/schema";
import type { NotificationSystem } from "./entities.ts";
import type { SeedDb } from "./db.ts";

/**
 * One seeded in-app notification card. `systemIndex` picks which representative
 * system (from `notificationSystems`) the card is about, so its subject chip
 * deep-links to a real seeded system and colours by that system's health.
 */
interface InboxCard {
  title: string;
  body: string;
  importance: "info" | "warning" | "critical";
  systemIndex: number;
  status: "healthy" | "unhealthy" | "degraded" | "unknown";
  isRead: boolean;
  action?: { label: string; url: string };
}

/**
 * The in-app notification feed the capturer shoots, ordered most-important
 * first: the seeder stamps DECREASING timestamps down the list, and the feed
 * sorts newest-first, so index 0 lands on top. A mix of importances and
 * read/unread states shows the feed's full visual language: a critical
 * incident, an SLO burn warning, an anomaly, and a couple of resolved/info
 * cards.
 */
const CARDS: InboxCard[] = [
  {
    title: "Checkout API is unhealthy",
    body: "Health checks for **checkout-api** started failing 34 minutes ago. A major incident is open and linked.",
    importance: "critical",
    systemIndex: 0,
    status: "unhealthy",
    isRead: false,
    action: { label: "View incident", url: "/incident/config" },
  },
  {
    title: "SLO burn rate high on payments",
    body: "**payments-service** is burning error budget fast - projected to breach its 30d target within the hour at the current rate.",
    importance: "warning",
    systemIndex: 1,
    status: "degraded",
    isRead: false,
    action: { label: "Open SLO", url: "/slo/" },
  },
  {
    title: "Anomaly detected: latency",
    body: "Latency on **web-storefront** deviated from its learned baseline and was confirmed as an anomaly.",
    importance: "warning",
    systemIndex: 3,
    status: "degraded",
    isRead: false,
  },
  {
    title: "Maintenance scheduled",
    body: "A rolling **Postgres 16** minor upgrade is scheduled for the primary database with a brief failover.",
    importance: "info",
    systemIndex: 2,
    status: "healthy",
    isRead: true,
    action: { label: "View maintenance", url: "/maintenance/config" },
  },
  {
    title: "Search latency recovered",
    body: "Elevated latency on search has returned to baseline after the index rebuild completed. The incident was resolved.",
    importance: "info",
    systemIndex: 1,
    status: "healthy",
    isRead: true,
  },
];

/**
 * Seed a populated in-app notification feed for the seeded admin so the
 * notifications overview renders a real inbox rather than the empty state.
 * Cards are written straight into the notification plugin's `notifications`
 * table (the feed has no create API - notifications are normally emitted by
 * platform events over days), keyed to the admin's user id with strictly
 * increasing timestamps so the newest card sorts to the top.
 */
export async function seedNotificationInbox({
  db,
  userId,
  notificationSystems,
}: {
  db: SeedDb;
  userId: string;
  notificationSystems: NotificationSystem[];
}): Promise<void> {
  if (notificationSystems.length === 0) return;

  const now = Date.now();
  const rows = CARDS.map((card, index) => {
    const system =
      notificationSystems[card.systemIndex] ?? notificationSystems[0];
    return {
      userId,
      title: card.title,
      body: card.body,
      importance: card.importance,
      isRead: card.isRead,
      action: card.action ?? null,
      subjects: [
        {
          kind: "catalog.system",
          id: system.id,
          name: system.name,
          url: `/catalog/system/${system.id}`,
          status: card.status,
        },
      ],
      // Decreasing timestamps: index 0 is newest (top of a newest-first feed).
      createdAt: new Date(now - index * 7 * 60_000),
    };
  });
  await db.insert(notifications).values(rows);
}
