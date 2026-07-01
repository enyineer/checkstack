#!/usr/bin/env bun
/**
 * RLAC drift guard (CI). Fails when a frontend management surface drifts from the
 * backend authorization contract: a route/nav gated on a `manage` rule whose
 * resource type the backend team-scopes MUST declare a matching
 * `manageCapability`, or a team-scoped user (team grant, no global rule) silently
 * sees no surface. See `.claude/rules/rlac.md`.
 *
 * How it stays authoritative:
 *   1. Derive the set of TEAM-SCOPABLE resource types from every `*-common`
 *      contract's `instanceAccess`, using the SAME `qualifyResourceType(pluginId,
 *      rule.resource)` the RPC middleware (core/backend-api/src/rpc.ts) uses to
 *      key grants - so a type is "team-scopable" here iff the middleware writes
 *      grants for it. `{ global: true }` is excluded (the deliberate
 *      "not team-scoped" marker); `parentScope.resourceType` names the parent.
 *   2. Import every `*-frontend` plugin descriptor and run the pure
 *      `auditManageCapabilities` (core/frontend-api) against that set.
 *
 * Exit 0 = clean, 1 = gaps found (or a plugin/contract could not be imported).
 * Run: `bun run check:manage-capabilities`.
 */

import { Glob } from "bun";
// Root scripts import workspace code via relative SOURCE paths (there is no
// `@checkstack/*` symlink at the repo root) - see scripts/generate-sdk.ts.
import {
  qualifyResourceType,
  type AccessRule,
} from "../core/common/src/index.ts";
import {
  auditManageCapabilities,
  type CapabilityGap,
} from "../core/frontend-api/src/manage-capability-audit.ts";
import type { FrontendPlugin } from "../core/frontend-api/src/plugin.ts";

const CONTRACT_GLOBS = [
  "core/*-common/src/rpc-contract.ts",
  "plugins/*-common/src/rpc-contract.ts",
];
const PLUGIN_GLOBS = [
  "core/*-frontend/src/index.tsx",
  "plugins/*-frontend/src/index.tsx",
];

/** Minimal shape of a proc's oRPC metadata we read (access + instanceAccess). */
interface InstanceAccess {
  global?: boolean;
  idParam?: string;
  listKey?: string;
  recordKey?: string;
  create?: unknown;
  parentScope?: { resourceType?: string };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Read `proc["~orpc"].meta` without trusting the shape. */
function procMeta(
  proc: unknown,
): { access?: AccessRule[]; instanceAccess?: InstanceAccess } | undefined {
  if (!isRecord(proc)) return undefined;
  const orpc = proc["~orpc"];
  if (!isRecord(orpc)) return undefined;
  const meta = orpc.meta;
  if (!isRecord(meta)) return undefined;
  const access = Array.isArray(meta.access)
    ? (meta.access as AccessRule[])
    : undefined;
  const instanceAccess = isRecord(meta.instanceAccess)
    ? (meta.instanceAccess as InstanceAccess)
    : undefined;
  return { access, instanceAccess };
}

/** A contract module export is a plain object whose values are procs. */
function contractProcs(value: unknown): unknown[] {
  if (!isRecord(value) || Array.isArray(value)) return [];
  const procs = Object.values(value);
  return procs.some((p) => procMeta(p)) ? procs : [];
}

async function scan(globs: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of globs) {
    for await (const file of new Glob(pattern).scan(".")) files.push(file);
  }
  return files.toSorted();
}

async function deriveTeamScopableTypes(): Promise<{
  types: Set<string>;
  errors: string[];
}> {
  const types = new Set<string>();
  const errors: string[] = [];
  for (const file of await scan(CONTRACT_GLOBS)) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(`../${file}`)) as Record<string, unknown>;
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message.split("\n")[0]}`);
      continue;
    }
    for (const exported of Object.values(mod)) {
      for (const proc of contractProcs(exported)) {
        const meta = procMeta(proc);
        const ia = meta?.instanceAccess;
        if (!ia || ia.global === true) continue;
        if (ia.parentScope?.resourceType) {
          types.add(ia.parentScope.resourceType);
          continue;
        }
        // idParam / listKey / recordKey / create: the OWN type of each rule.
        for (const rule of meta?.access ?? []) {
          types.add(qualifyResourceType(rule.pluginId, rule.resource));
        }
      }
    }
  }
  return { types, errors };
}

async function loadFrontendPlugins(): Promise<{
  plugins: FrontendPlugin[];
  errors: string[];
}> {
  const plugins: FrontendPlugin[] = [];
  const errors: string[] = [];
  for (const file of await scan(PLUGIN_GLOBS)) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(`../${file}`)) as Record<string, unknown>;
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message.split("\n")[0]}`);
      continue;
    }
    const plugin = Object.values(mod).find(
      (v): v is FrontendPlugin =>
        isRecord(v) && isRecord(v.metadata) && !!v.metadata.pluginId,
    );
    if (plugin) plugins.push(plugin);
  }
  return { plugins, errors };
}

function printGaps(gaps: CapabilityGap[]): void {
  const byPlugin = new Map<string, CapabilityGap[]>();
  for (const gap of gaps) {
    const list = byPlugin.get(gap.pluginId) ?? [];
    list.push(gap);
    byPlugin.set(gap.pluginId, list);
  }
  for (const [pluginId, list] of [...byPlugin].toSorted()) {
    console.error(`\n  ${pluginId}:`);
    for (const gap of list) console.error(`    - [${gap.kind}] ${gap.message}`);
  }
}

async function main(): Promise<void> {
  const { types, errors: contractErrors } = await deriveTeamScopableTypes();
  const { plugins, errors: pluginErrors } = await loadFrontendPlugins();

  const importErrors = [...contractErrors, ...pluginErrors];
  if (importErrors.length > 0) {
    console.error("❌ Could not import some modules (cannot audit them):");
    for (const error of importErrors) console.error(`   - ${error}`);
    process.exit(1);
  }

  const gaps = auditManageCapabilities({ plugins, teamScopableTypes: types });

  if (gaps.length === 0) {
    console.log(
      `✓ Manage-capability gating is consistent (${plugins.length} plugins, ` +
        `${types.size} team-scopable types, no gaps).`,
    );
    return;
  }

  console.error(
    `❌ Found ${gaps.length} frontend/backend RLAC gating gap(s). A management ` +
      `route gated on a team-scopable manage rule must declare a matching ` +
      `manageCapability (see .claude/rules/rlac.md):`,
  );
  printGaps(gaps);
  console.error(
    `\nTeam-scopable types (from backend contracts): ` +
      `${[...types].toSorted().join(", ")}`,
  );
  process.exit(1);
}

await main();
