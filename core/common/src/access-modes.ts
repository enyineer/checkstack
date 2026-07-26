/**
 * Access-mode descriptor registry.
 *
 * Every `instanceAccess` mode is described ONCE here so the API documentation can
 * render each endpoint's real authorization automatically - and so a new mode
 * cannot be added to {@link InstanceAccessConfig} without also describing it (the
 * `ACCESS_MODE_KEYS` guard below is a COMPILE-TIME error otherwise).
 *
 * This module is PURE (no I/O). Runtime ENFORCEMENT still lives in
 * `autoAuthMiddleware` and boot VALIDATION in `validateContractInstanceAccess`;
 * both reference {@link ACCESS_MODE_KEYS} for the mode list so the three cannot
 * drift on WHICH modes exist. Consolidating enforcement into this registry is a
 * deliberate future step (it is the security-critical request path).
 */
import type { AccessRule, InstanceAccessConfig } from "./access-utils";
import { qualifyResourceType } from "./types";

/**
 * The canonical list of every `instanceAccess` key. `satisfies` makes this a
 * COMPILE-TIME guard: adding a key to {@link InstanceAccessConfig} without adding
 * it here fails typecheck (the object literal below must be exhaustive), and the
 * `AllKeysCovered` assertion fails if this list omits any key.
 */
export const ACCESS_MODE_KEYS = [
  "global",
  "idParam",
  "listKey",
  "recordKey",
  "create",
  "parentScope",
  "bulkManage",
  "typeScoped",
  "objectRef",
] as const satisfies readonly (keyof InstanceAccessConfig)[];

export type AccessModeKey = (typeof ACCESS_MODE_KEYS)[number];

// Compile-time exhaustiveness: if a new InstanceAccessConfig key is added but not
// listed above, `Missing` is that key (not never) and this line fails to compile.
type Missing = Exclude<keyof InstanceAccessConfig, AccessModeKey>;
const _allKeysCovered: Missing extends never ? true : never = true;
void _allKeysCovered;

/** Context a descriptor needs to render its clause for ONE access rule. */
export interface AccessModeDescribeContext {
  /** Fully-qualified id of the endpoint's access rule, e.g. "catalog.system.read". */
  qualifiedRuleId: string;
  /** Fully-qualified resource type of the rule, e.g. "catalog.system". */
  qualifiedResourceType: string;
  /** The rule's own level. */
  action: "read" | "manage";
}

/** One rendered instance-authorization clause for the API docs. */
export interface AuthzClause {
  mode: AccessModeKey;
  /** Human-readable fragment, phrased to follow "Allowed if you ... OR ". */
  text: string;
  /** Structured facts for machine consumers of `x-orpc-meta.authorization`. */
  facts: Record<string, unknown>;
}

export interface AccessModeDescriptor {
  key: AccessModeKey;
  /**
   * Render this mode's clause for a given rule + config, or `null` when the mode
   * contributes no instance clause (only `global`, the opt-out, does that).
   */
  describe(
    config: InstanceAccessConfig,
    ctx: AccessModeDescribeContext,
  ): AuthzClause | null;
}

const clause = (
  mode: AccessModeKey,
  text: string,
  facts: Record<string, unknown>,
): AuthzClause => ({ mode, text, facts });

/**
 * Descriptor per mode. The object literal key set is `AccessModeKey`, so it MUST
 * be exhaustive - a new mode key is a typecheck error until described here.
 */
export const ACCESS_MODE_DESCRIPTORS: Record<
  AccessModeKey,
  AccessModeDescriptor
> = {
  global: {
    key: "global",
    // The deliberate opt-out: no instance dimension, only the global rule.
    describe: () => null,
  },
  idParam: {
    key: "idParam",
    describe: (cfg, ctx) =>
      cfg.idParam
        ? clause(
            "idParam",
            `you hold a team ${ctx.action} grant on the ${ctx.qualifiedResourceType} identified by \`${cfg.idParam}\``,
            { resourceType: ctx.qualifiedResourceType, action: ctx.action, idParam: cfg.idParam },
          )
        : null,
  },
  listKey: {
    key: "listKey",
    describe: (cfg, ctx) =>
      cfg.listKey
        ? clause(
            "listKey",
            `the \`${cfg.listKey}\` list is filtered to the ${ctx.qualifiedResourceType} you can ${ctx.action} (globally or via a team grant)`,
            { resourceType: ctx.qualifiedResourceType, action: ctx.action, listKey: cfg.listKey, filter: true },
          )
        : null,
  },
  recordKey: {
    key: "recordKey",
    describe: (cfg, ctx) =>
      cfg.recordKey
        ? clause(
            "recordKey",
            `the \`${cfg.recordKey}\` record is returned only if you can ${ctx.action} that ${ctx.qualifiedResourceType} (globally or via a team grant)`,
            { resourceType: ctx.qualifiedResourceType, action: ctx.action, recordKey: cfg.recordKey, filter: true },
          )
        : null,
  },
  create: {
    key: "create",
    describe: (cfg, ctx) => {
      if (!cfg.create) return null;
      const parts = [`a team create-capability grant for ${ctx.qualifiedResourceType}`];
      if (cfg.create.parent) {
        parts.push(
          `MANAGE on the parent ${cfg.create.parent.resourceType} identified by \`${cfg.create.parent.idParam}\``,
        );
      }
      if (cfg.create.alsoAcceptCreatorOf?.length) {
        parts.push(
          `a create-capability grant on a sibling type (${cfg.create.alsoAcceptCreatorOf.join(", ")})`,
        );
      }
      return clause("create", `you have ${parts.join(", or ")}`, {
        resourceType: ctx.qualifiedResourceType,
        parent: cfg.create.parent ?? null,
        alsoAcceptCreatorOf: cfg.create.alsoAcceptCreatorOf ?? [],
      });
    },
  },
  parentScope: {
    key: "parentScope",
    describe: (cfg) => {
      if (!cfg.parentScope) return null;
      const ps = cfg.parentScope;
      const action = ps.action ?? "read";
      const idPath = ps.idParam ?? ps.recordKey;
      return clause(
        "parentScope",
        `you can ${action} the parent ${ps.resourceType} identified by \`${idPath}\` (globally or via a team grant on the parent)`,
        { parentResourceType: ps.resourceType, action, idParam: ps.idParam ?? null, recordKey: ps.recordKey ?? null },
      );
    },
  },
  bulkManage: {
    key: "bulkManage",
    describe: (cfg, ctx) =>
      cfg.bulkManage
        ? clause(
            "bulkManage",
            `each id in \`${cfg.bulkManage.idsParam}\` is authorized independently — the operation applies only to the ${ctx.qualifiedResourceType} you can ${ctx.action} (globally or via a team grant); others are reported as forbidden`,
            { resourceType: ctx.qualifiedResourceType, action: ctx.action, idsParam: cfg.bulkManage.idsParam, partition: true },
          )
        : null,
  },
  typeScoped: {
    key: "typeScoped",
    describe: (cfg, ctx) => {
      if (!cfg.typeScoped) return null;
      const action = cfg.typeScoped.action ?? ctx.action;
      return clause(
        "typeScoped",
        `you hold ANY team grant for ${ctx.qualifiedResourceType} (a viewer/editor/owner grant on any instance, or a create-capability grant)`,
        { resourceType: ctx.qualifiedResourceType, action },
      );
    },
  },
  objectRef: {
    key: "objectRef",
    describe: (cfg) => {
      if (!cfg.objectRef) return null;
      const action = cfg.objectRef.action ?? "manage";
      return clause(
        "objectRef",
        `you can ${action} the object identified by \`${cfg.objectRef.typeParam}\`/\`${cfg.objectRef.idParam}\` (its own \`<type>.${action}\` rule, or a team editor/owner grant on it); team-private objects require a team grant`,
        { typeParam: cfg.objectRef.typeParam, idParam: cfg.objectRef.idParam, action, dynamicType: true },
      );
    },
  },
};

/** The subset of a procedure's metadata this module reads. */
export interface AuthorizableMeta {
  userType?: string;
  access?: AccessRule[];
  /** Contract-level override applied to every access rule (bulk / objectRef). */
  instanceAccess?: InstanceAccessConfig;
  /**
   * Prose authorization note for HANDLER-enforced authz that no declarative mode
   * can express (rendered as an instance clause). See `ProcedureMetadata`.
   */
  accessNote?: { summary: string };
}

/** A procedure's full authorization model, derived purely from its metadata. */
export interface AuthorizationSpec {
  /** Principal requirement (userType), e.g. "authenticated" | "public" | "service". */
  authentication: string;
  /** Global rule ids that satisfy access on their own (the OR-override side). */
  globalRules: string[];
  /** Instance-scoping clauses (team grants, per-object, parent, ...) - MIDDLEWARE-enforced. */
  instance: AuthzClause[];
  /**
   * An ADDITIONAL rule enforced in the handler (not by the middleware) that no
   * declarative mode can express - authored prose, backed by behavioral tests
   * (see `ProcedureMetadata.accessNote`). Distinguished from `instance` because
   * it is not machine-derived from a mode.
   */
  handlerNote?: string;
  /** One rendered paragraph for the OpenAPI operation description. */
  summary: string;
}

/**
 * Derive the {@link AuthorizationSpec} for a procedure from its contract
 * metadata - the SAME inputs `autoAuthMiddleware` enforces, so the doc cannot
 * drift from the rule. Mirrors the middleware's model: a rule with no scoping
 * mode (or `global: true`) is a hard global requirement; a rule WITH a mode makes
 * its qualified id the global OR-override and adds the mode's instance clause.
 */
export function buildAuthorizationSpec(
  meta: AuthorizableMeta,
  pluginId: string,
): AuthorizationSpec {
  const authentication = meta.userType ?? "authenticated";
  const globalRules: string[] = [];
  const instance: AuthzClause[] = [];

  for (const rule of meta.access ?? []) {
    const effective = meta.instanceAccess ?? rule.instanceAccess;
    const qualifiedRuleId = `${pluginId}.${rule.id}`;
    const qualifiedResourceType = qualifyResourceType(pluginId, rule.resource);

    // Holding the rule's own global grant always satisfies access.
    if (!globalRules.includes(qualifiedRuleId)) globalRules.push(qualifiedRuleId);

    if (!effective || effective.global === true) continue;

    for (const key of ACCESS_MODE_KEYS) {
      if (key === "global" || effective[key] === undefined) continue;
      const c = ACCESS_MODE_DESCRIPTORS[key].describe(effective, {
        qualifiedRuleId,
        qualifiedResourceType,
        action: rule.level,
      });
      if (c) instance.push(c);
    }
  }

  const handlerNote = meta.accessNote?.summary;

  return {
    authentication,
    globalRules,
    instance,
    ...(handlerNote ? { handlerNote } : {}),
    summary: renderSummary({ authentication, globalRules, instance, handlerNote }),
  };
}

function renderSummary({
  authentication,
  globalRules,
  instance,
  handlerNote,
}: Omit<AuthorizationSpec, "summary">): string {
  const authSentence =
    authentication === "anonymous"
      ? "No authentication required."
      : authentication === "public"
        ? "Open to anyone; authenticated callers additionally get their own grants."
        : authentication === "service"
          ? "For trusted service-to-service callers."
          : authentication === "user"
            ? "Requires an authenticated user."
            : "Requires an authenticated user or application.";

  const noteSentence = handlerNote
    ? ` Additional handler-enforced rule: ${handlerNote}`
    : "";

  if (globalRules.length === 0 && instance.length === 0) {
    return `${authSentence} No additional access rule.${noteSentence}`;
  }

  const options: string[] = [];
  if (globalRules.length > 0) {
    options.push(`you hold ${globalRules.map((r) => `\`${r}\``).join(" or ")}`);
  }
  for (const c of instance) options.push(c.text);

  return `${authSentence} Allowed if ${options.join(", or ")}.${noteSentence}`;
}
