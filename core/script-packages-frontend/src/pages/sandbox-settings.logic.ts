import {
  sandboxPolicySchema,
  type SandboxPolicy,
  type SandboxPolicyInput,
} from "@checkstack/common";

/**
 * DOM-free logic for the global script-sandbox settings page. Kept separate
 * from the `.tsx` so it is unit-testable under `bun test` (run from the repo
 * root WITHOUT happy-dom). The page component is a thin React shell over these
 * pure helpers.
 */

/** Editable, flattened form state mirroring the policy editor's controls. */
export interface SandboxFormState {
  enabled: boolean;
  onUnavailable: "degrade" | "fail";
  networkMode: "deny" | "allowlist" | "unrestricted";
  /** Raw multiline textarea content; one IP / CIDR per line. */
  allowText: string;
  denyLinkLocalAndMetadata: boolean;
  filesystemMode: "off" | "scratch-only" | "scratch-plus-ro";
  privilegeMode: "inherit" | "drop-to-uid";
  /** Resource caps as strings (text inputs); blank = leave unset. */
  cpuSeconds: string;
  memoryMb: string;
  maxOpenFiles: string;
  maxProcesses: string;
  maxOutputMb: string;
  maxFileSizeMb: string;
}

const BYTES_PER_MB = 1024 * 1024;

/**
 * The seed default the admin sees for a FRESH global policy, before any row is
 * stored. It mirrors the shipped secure default profile and is FAIL-CLOSED
 * (`onUnavailable: "fail"`): when a layer cannot be enforced the run is refused
 * rather than silently degraded. The backend resolves the same secure default
 * for an empty settings table, so this constant only seeds the editor's initial
 * state (and keeps the UI deterministic before the loader query resolves); it
 * never overrides a stored policy.
 */
export const DEFAULT_SANDBOX_FORM: SandboxFormState = {
  enabled: true,
  onUnavailable: "fail",
  networkMode: "allowlist",
  allowText: "",
  denyLinkLocalAndMetadata: true,
  filesystemMode: "scratch-plus-ro",
  privilegeMode: "drop-to-uid",
  cpuSeconds: "60",
  memoryMb: "512",
  maxOpenFiles: "1024",
  maxProcesses: "256",
  maxOutputMb: "5",
  maxFileSizeMb: "256",
};

/** Bytes -> MB string for a text input, or "" when the cap is unset. */
function bytesToMbText(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  return String(bytes / BYTES_PER_MB);
}

/** Integer -> text, or "" when unset. */
function numToText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/**
 * Seed the editable form state from a resolved policy (the loader query result).
 */
export function policyToForm(policy: SandboxPolicy): SandboxFormState {
  return {
    enabled: policy.enabled,
    onUnavailable: policy.onUnavailable,
    networkMode: policy.network.mode,
    allowText: policy.network.allow.join("\n"),
    denyLinkLocalAndMetadata: policy.network.denyLinkLocalAndMetadata,
    filesystemMode: policy.filesystem.mode,
    privilegeMode: policy.privilege.mode,
    cpuSeconds: numToText(policy.resources.cpuSeconds),
    memoryMb: bytesToMbText(policy.resources.memoryBytes),
    maxOpenFiles: numToText(policy.resources.maxOpenFiles),
    maxProcesses: numToText(policy.resources.maxProcesses),
    maxOutputMb: bytesToMbText(policy.resources.maxOutputBytes),
    maxFileSizeMb: bytesToMbText(policy.resources.maxFileSizeBytes),
  };
}

/** Parse a multiline allow list into trimmed, non-empty entries. */
export function parseAllowList(allowText: string): string[] {
  return allowText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** A positive-int text field -> number, or undefined when blank/invalid-empty. */
function parsePositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

/** An MB text field -> bytes, or undefined when blank. */
function parseMbToBytes(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * BYTES_PER_MB);
}

/**
 * Build the FULL policy input to send to `setSandboxPolicy` from form state.
 *
 * The write endpoint treats its input as a partial merged over the safe
 * default, but the editor exposes every layer, so we send a complete object
 * (each layer explicit) - that is still a valid `SandboxPolicyInput`. Unset
 * resource caps are OMITTED (left out of the object) so the schema treats them
 * as "not capped by this layer" rather than coercing a 0/NaN.
 */
export function formToPolicyInput(form: SandboxFormState): SandboxPolicyInput {
  const resources: Record<string, number> = {};
  const cpu = parsePositiveInt(form.cpuSeconds);
  if (cpu !== undefined) resources.cpuSeconds = cpu;
  const mem = parseMbToBytes(form.memoryMb);
  if (mem !== undefined) resources.memoryBytes = mem;
  const nofile = parsePositiveInt(form.maxOpenFiles);
  if (nofile !== undefined) resources.maxOpenFiles = nofile;
  const nproc = parsePositiveInt(form.maxProcesses);
  if (nproc !== undefined) resources.maxProcesses = nproc;
  const out = parseMbToBytes(form.maxOutputMb);
  if (out !== undefined) resources.maxOutputBytes = out;
  const fsize = parseMbToBytes(form.maxFileSizeMb);
  if (fsize !== undefined) resources.maxFileSizeBytes = fsize;

  return {
    enabled: form.enabled,
    onUnavailable: form.onUnavailable,
    resources,
    filesystem: { mode: form.filesystemMode },
    network: {
      mode: form.networkMode,
      allow: parseAllowList(form.allowText),
      denyLinkLocalAndMetadata: form.denyLinkLocalAndMetadata,
    },
    privilege: { mode: form.privilegeMode },
  };
}

/**
 * Validate the form's would-be policy input against the canonical schema.
 * Returns the first error message, or `null` when valid. Used to surface a
 * problem (e.g. a non-positive resource cap) before submit.
 */
export function validateForm(form: SandboxFormState): string | null {
  const parsed = sandboxPolicySchema.safeParse(formToPolicyInput(form));
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? "Invalid sandbox policy";
}
