import { and, count, eq, gte } from "drizzle-orm";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
  ScopedQueryRunner,
} from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import {
  DEFAULT_EMAIL_SUBSCRIBERS_HOURLY_QUOTA,
  type StatusPageSubscriber,
} from "@checkstack/status-page-common";
import * as schema from "./schema";
import {
  statusPages,
  statusPageSubscribers,
  statusPageVerifiedEmails,
} from "./schema";
import {
  subscriberUrls,
  type SubscriberMailer,
} from "./subscriber-mailer";
import type {
  WidgetResolveContext,
  WidgetTypeRegistry,
} from "./widget-registry";

/** A public-safe notification summary for the email fan-out (no internal fields). */
export interface SystemsFanoutEvent {
  title: string;
  /** Markdown body (includes the update text). */
  body: string;
  /** Concrete affected catalog system ids. */
  systemIds: string[];
  /** Optional deep link (the notification's primary action URL). */
  link?: string;
}

type Db = SafeDatabase<typeof schema>;

/** Do-not-resend window for an unverified subscriber (anti email-bombing). */
const VERIFICATION_RESEND_COOLDOWN_MS = 5 * 60_000;

/**
 * Coarse per-PAGE quota on NEW subscribe attempts, on top of the per-(page,email)
 * cooldown. The per-(page,email) cooldown stops re-bombing ONE address; this caps
 * fan-out of verification emails to MANY attacker-chosen addresses for a single
 * page. Enforced by counting subscriber rows CREATED for the page within the
 * window, so it is DURABLE and identical on every pod (never process-local, which
 * would not hold under horizontal scale). The per-hour cap itself is configurable
 * per page (`emailSubscribersHourlyQuota`); a null column uses the default.
 */
const SUBSCRIBE_PAGE_WINDOW_MS = 60 * 60_000;

function newToken(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
}

export interface SubscriberServiceDeps {
  db: Db;
  logger: Logger;
  mailer: SubscriberMailer;
  /** Public base URL for verification / unsubscribe links. */
  baseUrl: string;
  /** Widget-type registry, used to resolve a page's live event-feed scope. */
  registry: WidgetTypeRegistry;
  /**
   * Trusted service RPC client for the send-time scope resolution (the widget's
   * own `resolveScopedSystems` reads the catalog with it, exactly as the public
   * page resolve does).
   */
  rpcClient: RpcClient;
}

/**
 * Anonymous email-subscriber management for status pages: double-opt-in
 * subscribe, verify, unsubscribe, admin list/remove, and incident fan-out.
 *
 * SECURITY: the public methods (`subscribe` / `verify` / `unsubscribe`) ALWAYS
 * resolve to a uniform `{ ok: true }` and never reveal whether a page, token, or
 * address exists - so they cannot enumerate pages or subscribers. Delivery of
 * the verification email is out-of-band via the injected mailer.
 */
export class SubscriberService {
  constructor(private readonly deps: SubscriberServiceDeps) {}

  /**
   * True when a NEW subscriber row would exceed the page's rolling-hour quota.
   * Counted over durable rows so the cap is identical on every pod; the cap is the
   * page's configured quota (null -> platform default). Only gates NEW inserts;
   * re-activating an existing row is never quota-limited.
   */
  private async isOverHourlyQuota(input: {
    statusPageId: string;
    quota: number | null;
  }): Promise<boolean> {
    const quota = input.quota ?? DEFAULT_EMAIL_SUBSCRIBERS_HOURLY_QUOTA;
    const windowStart = new Date(Date.now() - SUBSCRIBE_PAGE_WINDOW_MS);
    const [recent] = await this.deps.db
      .select({ n: count() })
      .from(statusPageSubscribers)
      .where(
        and(
          eq(statusPageSubscribers.statusPageId, input.statusPageId),
          gte(statusPageSubscribers.createdAt, windowStart),
        ),
      );
    return (recent?.n ?? 0) >= quota;
  }

  /** True when the address has proven ownership on ANY page (global registry). */
  private async isEmailGloballyVerified(email: string): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ id: statusPageVerifiedEmails.id })
      .from(statusPageVerifiedEmails)
      .where(eq(statusPageVerifiedEmails.email, email))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Subscribe an address. Idempotent per (page, email). Always resolves
   * `{ ok: true }` regardless of page existence / prior state (enumeration guard).
   *
   * Three flows, decided by the page's `emailVerificationRequired`, then by the
   * global verified-email registry:
   *  - Page does NOT require verification -> create the row ACTIVE, no email, no
   *    registry read/write (the operator's deliberate trust choice).
   *  - Page requires verification AND the address is already globally verified ->
   *    create the row ACTIVE immediately + send a COURTESY email (with a one-click
   *    unsubscribe) so a malicious add is always caught. No verification email.
   *  - Otherwise -> create the row PENDING + send the verification email
   *    (respecting the per-(page,email) resend cooldown).
   *
   * The per-page hourly quota gates every NEW row; the mandatory unsubscribe link
   * rides every email; a page with subscriptions disabled fails closed.
   */
  async subscribe(input: { slug: string; email: string }): Promise<{ ok: true }> {
    const email = input.email.trim().toLowerCase();
    try {
      // Only published, public pages that OPTED IN accept subscriptions. A miss
      // (or opt-out) still returns ok (constant outcome) so a prober cannot tell
      // a page apart from a typo or a disabled page (fail closed, no leak).
      const [page] = await this.deps.db
        .select({
          id: statusPages.id,
          slug: statusPages.slug,
          title: statusPages.title,
          emailSubscriptionsEnabled: statusPages.emailSubscriptionsEnabled,
          emailSubscribersHourlyQuota: statusPages.emailSubscribersHourlyQuota,
          emailVerificationRequired: statusPages.emailVerificationRequired,
        })
        .from(statusPages)
        .where(eq(statusPages.slug, input.slug))
        .limit(1);
      if (!page || !page.emailSubscriptionsEnabled) return { ok: true };

      const [existing] = await this.deps.db
        .select()
        .from(statusPageSubscribers)
        .where(
          and(
            eq(statusPageSubscribers.statusPageId, page.id),
            eq(statusPageSubscribers.email, email),
          ),
        )
        .limit(1);

      if (existing?.verified) return { ok: true }; // already active

      const unsubscribeToken = existing?.unsubscribeToken ?? newToken("unsub");
      const now = new Date();

      // Decide whether this subscription becomes ACTIVE immediately (no
      // verification email): either the page opted out of verification, or the
      // address is already globally proven.
      const globallyVerified =
        page.emailVerificationRequired &&
        (await this.isEmailGloballyVerified(email));
      const activateImmediately =
        !page.emailVerificationRequired || globallyVerified;

      if (activateImmediately) {
        if (existing) {
          await this.deps.db
            .update(statusPageSubscribers)
            .set({ verified: true, verifiedAt: now, verificationToken: null })
            .where(eq(statusPageSubscribers.id, existing.id));
        } else {
          if (
            await this.isOverHourlyQuota({
              statusPageId: page.id,
              quota: page.emailSubscribersHourlyQuota,
            })
          ) {
            return { ok: true };
          }
          await this.deps.db.insert(statusPageSubscribers).values({
            statusPageId: page.id,
            email,
            verificationToken: null,
            unsubscribeToken,
            verified: true,
            verifiedAt: now,
          });
        }
        // Verification-required page reached here => the address was already
        // globally proven: always tell the owner (courtesy) so a malicious add is
        // caught. An opt-out page sends NOTHING (the operator's trust choice).
        if (globallyVerified) {
          const { unsubscribeUrl } = subscriberUrls({
            baseUrl: this.deps.baseUrl,
            slug: page.slug,
            verificationToken: "",
            unsubscribeToken,
          });
          await this.deps.mailer.sendRaw({
            to: email,
            subject: `You were subscribed to ${page.title} status updates`,
            body:
              `You were subscribed to ${page.title} status updates because this ` +
              "address has already been verified on our status pages. If this " +
              "wasn't you, unsubscribe using the link below.",
            unsubscribeUrl,
          });
        }
        return { ok: true };
      }

      // Verification required and the address is NOT yet proven: pending row +
      // verification email (respecting the resend cooldown).
      const verificationToken = newToken("verify");
      if (existing) {
        const age = Date.now() - existing.createdAt.getTime();
        if (age < VERIFICATION_RESEND_COOLDOWN_MS) return { ok: true };
        await this.deps.db
          .update(statusPageSubscribers)
          .set({ verificationToken, createdAt: now })
          .where(eq(statusPageSubscribers.id, existing.id));
      } else {
        if (
          await this.isOverHourlyQuota({
            statusPageId: page.id,
            quota: page.emailSubscribersHourlyQuota,
          })
        ) {
          return { ok: true };
        }
        await this.deps.db.insert(statusPageSubscribers).values({
          statusPageId: page.id,
          email,
          verificationToken,
          unsubscribeToken,
          verified: false,
        });
      }

      const { verifyUrl, unsubscribeUrl } = subscriberUrls({
        baseUrl: this.deps.baseUrl,
        slug: page.slug,
        verificationToken,
        unsubscribeToken,
      });
      await this.deps.mailer.sendRaw({
        to: email,
        subject: "Confirm your status page subscription",
        body:
          "Confirm your subscription to status updates by opening this link:\n\n" +
          `${verifyUrl}\n`,
        unsubscribeUrl,
      });
    } catch (error) {
      // Never surface internal failures to the anonymous caller.
      this.deps.logger.warn("status-page subscribe failed", { error });
    }
    return { ok: true };
  }

  /**
   * True when the subscriber row's owning page currently has email
   * subscriptions enabled. Fails closed (false) on a missing row/page so the
   * token endpoints do nothing when the page opted out.
   */
  private async tokenPageEnabled(opts: {
    /** Scoped db, or the batching `tx` when composed inside verify/unsubscribe. */
    runner: ScopedQueryRunner<typeof schema>;
    subscriberId: string;
    statusPageId: string;
  }): Promise<boolean> {
    const { runner, subscriberId, statusPageId } = opts;
    const [page] = await runner
      .select({
        emailSubscriptionsEnabled: statusPages.emailSubscriptionsEnabled,
      })
      .from(statusPages)
      .where(eq(statusPages.id, statusPageId))
      .limit(1);
    // subscriberId is threaded through only for readability at call sites.
    void subscriberId;
    return page?.emailSubscriptionsEnabled ?? false;
  }

  /**
   * Confirm a subscription by its verification token. Always resolves ok.
   *
   * Beyond flipping this row to verified, it (1) UPSERTS the address into the
   * platform-global verified-email registry (proving ownership once, for all
   * pages), and (2) activates any OTHER pending rows for the SAME address in one
   * update, so a user who subscribed to several pages before clicking does not
   * have to confirm each - and no extra email goes out (those were self-initiated
   * and already received their own verification mail). Idempotent.
   */
  async verify(input: { token: string }): Promise<{ ok: true }> {
    try {
      // All four steps are pure db with no email between them, so the token
      // lookup, page-enabled check, sibling activation, and global-registry
      // upsert share ONE scoped transaction (single SET LOCAL search_path).
      await withScopedTransaction(this.deps.db, async (tx) => {
        const [sub] = await tx
          .select({
            id: statusPageSubscribers.id,
            statusPageId: statusPageSubscribers.statusPageId,
            email: statusPageSubscribers.email,
          })
          .from(statusPageSubscribers)
          .where(eq(statusPageSubscribers.verificationToken, input.token))
          .limit(1);
        // Fail closed when the owning page disabled subscriptions.
        if (
          !sub ||
          !(await this.tokenPageEnabled({
            runner: tx,
            subscriberId: sub.id,
            statusPageId: sub.statusPageId,
          }))
        ) {
          return;
        }
        const now = new Date();
        // Activate THIS row plus every other still-pending row for the same
        // address (global-once confirmation). A single update covers both.
        await tx
          .update(statusPageSubscribers)
          .set({ verified: true, verifiedAt: now, verificationToken: null })
          .where(
            and(
              eq(statusPageSubscribers.email, sub.email),
              eq(statusPageSubscribers.verified, false),
            ),
          );
        // Register global ownership of the address. Idempotent: keep the
        // earliest verifiedAt on a repeat confirmation.
        await tx
          .insert(statusPageVerifiedEmails)
          .values({ email: sub.email, verifiedAt: now })
          .onConflictDoNothing({ target: statusPageVerifiedEmails.email });
      });
    } catch (error) {
      this.deps.logger.warn("status-page verify failed", { error });
    }
    return { ok: true };
  }

  /** Remove a subscription by its unsubscribe token. Always resolves ok. */
  async unsubscribe(input: { token: string }): Promise<{ ok: true }> {
    try {
      // Token lookup, page-enabled check, and delete are all pure db: one
      // scoped transaction pays a single SET LOCAL search_path.
      await withScopedTransaction(this.deps.db, async (tx) => {
        const [sub] = await tx
          .select({
            id: statusPageSubscribers.id,
            statusPageId: statusPageSubscribers.statusPageId,
          })
          .from(statusPageSubscribers)
          .where(eq(statusPageSubscribers.unsubscribeToken, input.token))
          .limit(1);
        if (
          sub &&
          (await this.tokenPageEnabled({
            runner: tx,
            subscriberId: sub.id,
            statusPageId: sub.statusPageId,
          }))
        ) {
          await tx
            .delete(statusPageSubscribers)
            .where(eq(statusPageSubscribers.id, sub.id));
        }
      });
    } catch (error) {
      this.deps.logger.warn("status-page unsubscribe failed", { error });
    }
    return { ok: true };
  }

  /** Admin: list a page's subscribers (tokens never exposed). */
  async list(input: { statusPageId: string }): Promise<StatusPageSubscriber[]> {
    const rows = await this.deps.db
      .select()
      .from(statusPageSubscribers)
      .where(eq(statusPageSubscribers.statusPageId, input.statusPageId));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      verified: r.verified,
      createdAt: r.createdAt.toISOString(),
      verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    }));
  }

  /** Admin: remove one subscriber, scoped to its owning page. */
  async remove(input: {
    statusPageId: string;
    id: string;
  }): Promise<boolean> {
    const deleted = await this.deps.db
      .delete(statusPageSubscribers)
      .where(
        and(
          eq(statusPageSubscribers.id, input.id),
          eq(statusPageSubscribers.statusPageId, input.statusPageId),
        ),
      )
      .returning({ id: statusPageSubscribers.id });
    return deleted.length > 0;
  }

  /**
   * Delete every subscriber of a page (defense-in-depth reconcile on page
   * deletion). The FK is `ON DELETE CASCADE`, so removing the page row already
   * removes these; calling this explicitly in the delete handler makes the intent
   * clear and invalidates all pending verify/unsubscribe tokens by removing the
   * rows that carry them.
   */
  async removeAllForPage(statusPageId: string): Promise<number> {
    const deleted = await this.deps.db
      .delete(statusPageSubscribers)
      .where(eq(statusPageSubscribers.statusPageId, statusPageId))
      .returning({ id: statusPageSubscribers.id });
    return deleted.length;
  }

  /**
   * Fan a notification (incident / maintenance / health) out to the VERIFIED
   * email subscribers of every PUBLISHED, public, email-ENABLED page that
   * CURRENTLY surfaces at least one of the affected systems through an incident
   * or maintenance widget.
   *
   * SEND-TIME SCOPING IS THE PRIVACY BOUNDARY, and it is SINGLE-SOURCE: for each
   * page we ask every event-feed widget for its CURRENT effective system scope
   * via the widget's own `resolveScopedSystems`, which expands catalog groups
   * from the SAME live source (`getGroups`) the widget renders from. So the
   * fan-out can never over- or under-deliver relative to what the page actually
   * shows: a removed system, disabled page, emptied/removed widget, changed group
   * membership, or deleted page is honored by construction, never off a stale
   * snapshot or a parallel copy of group membership. status-page-backend never
   * imports the catalog - the owning domain plugin supplies the expansion.
   */
  async notifyForSystems(event: SystemsFanoutEvent): Promise<number> {
    if (event.systemIds.length === 0) return 0;
    const affected = new Set(event.systemIds);

    const pages = await this.deps.db
      .select({
        id: statusPages.id,
        slug: statusPages.slug,
        publishedLayout: statusPages.publishedLayout,
        visibility: statusPages.visibility,
        emailSubscriptionsEnabled: statusPages.emailSubscriptionsEnabled,
      })
      .from(statusPages);

    // One memo for the WHOLE fan-out: the widget scope resolvers read the catalog
    // (e.g. getGroups) through this cache, so the fan-out issues a single catalog
    // fetch shared across every page instead of one per page.
    const memo = new Map<string, Promise<unknown>>();
    const ctx: WidgetResolveContext = {
      rpcClient: this.deps.rpcClient,
      cache: <T,>(key: string, loader: () => Promise<T>): Promise<T> => {
        const existing = memo.get(key);
        if (existing) return existing as Promise<T>;
        const created = loader();
        memo.set(key, created);
        return created;
      },
    };

    let sent = 0;
    for (const page of pages) {
      if (
        page.visibility !== "public" ||
        !page.publishedLayout ||
        !page.emailSubscriptionsEnabled
      ) {
        continue;
      }
      // Does any event-feed widget on this page CURRENTLY surface an affected
      // system? Fail CLOSED: a resolver error contributes nothing (no email).
      let surfaced = false;
      for (const block of page.publishedLayout) {
        const widget = this.deps.registry.get(block.type);
        if (!widget?.resolveScopedSystems) continue;
        try {
          const scope = await widget.resolveScopedSystems({
            config: block.config,
            ctx,
          });
          if ([...affected].some((id) => scope.has(id))) {
            surfaced = true;
            break;
          }
        } catch (error) {
          this.deps.logger.warn("status-page fan-out scope resolve failed", {
            slug: page.slug,
            blockType: block.type,
            error: extractErrorMessage(error),
          });
        }
      }
      if (!surfaced) continue;

      const subs = await this.deps.db
        .select()
        .from(statusPageSubscribers)
        .where(
          and(
            eq(statusPageSubscribers.statusPageId, page.id),
            eq(statusPageSubscribers.verified, true),
          ),
        );
      for (const sub of subs) {
        const { unsubscribeUrl } = subscriberUrls({
          baseUrl: this.deps.baseUrl,
          slug: page.slug,
          verificationToken: "",
          unsubscribeToken: sub.unsubscribeToken,
        });
        const body = event.link
          ? `${event.body}\n\n[View details](${event.link})`
          : event.body;
        await this.deps.mailer.sendRaw({
          to: sub.email,
          subject: event.title,
          body,
          unsubscribeUrl,
        });
        sent += 1;
      }
    }
    return sent;
  }
}
