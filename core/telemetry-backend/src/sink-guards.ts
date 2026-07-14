/**
 * Shared stream-bind authorization for telemetry sink contributions.
 *
 * Every signal-owning sink (logstream, metricstream, tracestream) answers the
 * SAME security question when a source binds one of its streams: may this caller
 * MANAGE the stream? The body is identical across sinks - service-user bypass,
 * then a global-rule check, then a per-resource team-grant check via
 * `auth.check`, else FORBIDDEN - and `describeStream` is a plain stream lookup.
 * Factoring it here keeps that security-relevant logic in ONE place so the sinks
 * cannot drift; each sink still owns its own record-mapping / write pipeline.
 *
 * Dependency direction is fine: a DOMAIN stream plugin (metricstream/logstream)
 * imports this platform helper; the platform imports no stream plugin.
 */

import { ORPCError } from "@orpc/server";
import type { AuthService, AuthUser } from "@checkstack/backend-api";

/** A stream's identity, or null when it does not exist. */
export type ResolveStream = (
  streamId: string,
) => Promise<{ id: string; name: string } | null>;

/**
 * Batched stream resolver: look up MANY streams by id in ONE set-based query,
 * keyed by id (an unknown id maps to null). Backs the batched `describeStreams`.
 */
export type ResolveStreams = (
  streamIds: string[],
) => Promise<Record<string, { id: string; name: string } | null>>;

/** List every stream (id + display name) the owning plugin manages. */
export type ListStreams = () => Promise<{ id: string; name: string }[]>;

/** The authorization-bearing methods a sink contribution shares. */
export interface StreamBindAuthorizer {
  assertBindable(opts: { streamId: string; user: AuthUser }): Promise<void>;
  describeStream(opts: {
    streamId: string;
  }): Promise<{ id: string; name: string } | null>;
  /**
   * Batched `describeStream` for list read paths. Present only when the sink
   * supplies a `resolveStreams` seam; a sink without it falls back to per-id
   * `describeStream` on the platform side.
   */
  describeStreams?(opts: {
    streamIds: string[];
  }): Promise<Record<string, { id: string; name: string } | null>>;
  /**
   * List the streams `user` may BIND (manage), filtered by the SAME rule as
   * `assertBindable` (service bypass / global rule / per-resource team grant).
   * Present only when the sink supplies a `listStreams` seam, so a sink that
   * has not adopted the binding picker simply omits it.
   */
  listBindableStreams?(opts: {
    user: AuthUser;
  }): Promise<{ id: string; name: string }[]>;
}

/** Uppercase the first character of a noun for a sentence-leading message. */
function capitalize(noun: string): string {
  return noun.length === 0 ? noun : noun[0]!.toUpperCase() + noun.slice(1);
}

/**
 * Build the shared authorizer a sink exposes.
 *
 * - `resolveStream` looks a stream up by id (existence + display name).
 * - `resolveStreams` (optional) resolves MANY ids in one query; supply it to
 *   expose the batched `describeStreams` used by list read paths.
 * - `listStreams` (optional) lists every stream id + name the plugin manages;
 *   supply it to expose `listBindableStreams` for the binding picker.
 * - `auth` evaluates the per-resource team grant (and, for the picker, the bulk
 *   grant filter).
 * - `manageRuleId` is the qualified global manage rule that authorizes any stream.
 * - `objectType` is the stream's team-scoped resource type for `auth.check`.
 * - `noun` names the stream in error messages (e.g. "log stream", "metric stream").
 */
export function createStreamBindAuthorizer({
  resolveStream,
  resolveStreams,
  listStreams,
  auth,
  manageRuleId,
  objectType,
  noun,
}: {
  resolveStream: ResolveStream;
  resolveStreams?: ResolveStreams;
  listStreams?: ListStreams;
  auth: Pick<AuthService, "check" | "listAccessibleObjectIds">;
  manageRuleId: string;
  objectType: string;
  noun: string;
}): StreamBindAuthorizer {
  return {
    async assertBindable({ streamId, user }) {
      const stream = await resolveStream(streamId);
      if (!stream) {
        throw new ORPCError("NOT_FOUND", {
          message: `${capitalize(noun)} not found.`,
        });
      }

      // A trusted service-to-service call is not user-scoped; the platform has
      // already authorized the machine path. Bind is allowed.
      if (user.type === "service") return;

      const rules = user.accessRules ?? [];
      if (rules.includes("*") || rules.includes(manageRuleId)) return;

      const { hasAccess } = await auth.check({
        userId: user.id,
        userType: user.type,
        objectType,
        objectId: streamId,
        action: "manage",
        hasGlobalAccess: false,
      });
      if (hasAccess) return;

      throw new ORPCError("FORBIDDEN", {
        message: `You do not have permission to bind this ${noun}.`,
      });
    },

    async describeStream({ streamId }) {
      return resolveStream(streamId);
    },

    // Exposed only when the sink supplies a batched `resolveStreams` seam.
    ...(resolveStreams
      ? {
          async describeStreams({ streamIds }) {
            return resolveStreams(streamIds);
          },
        }
      : {}),

    // Exposed only when the sink supplies a `listStreams` seam.
    ...(listStreams
      ? {
          async listBindableStreams({ user }) {
            const all = await listStreams();
            // Service / global-rule callers may bind every stream; skip the
            // per-resource filter entirely (mirrors `assertBindable`).
            if (user.type === "service") return all;
            const rules = user.accessRules ?? [];
            if (rules.includes("*") || rules.includes(manageRuleId)) return all;
            if (all.length === 0) return [];

            const accessibleIds = await auth.listAccessibleObjectIds({
              userId: user.id,
              userType: user.type,
              objectType,
              objectIds: all.map((stream) => stream.id),
              action: "manage",
              hasGlobalAccess: false,
            });
            const accessible = new Set(accessibleIds);
            return all.filter((stream) => accessible.has(stream.id));
          },
        }
      : {}),
  };
}
