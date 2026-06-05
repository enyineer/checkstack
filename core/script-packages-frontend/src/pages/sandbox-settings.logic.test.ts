import { describe, expect, it } from "bun:test";
import { sandboxPolicySchema } from "@checkstack/common";
import {
  policyToForm,
  formToPolicyInput,
  parseAllowList,
  validateForm,
  DEFAULT_SANDBOX_FORM,
  type SandboxFormState,
} from "./sandbox-settings.logic";

const SAFE_DEFAULT = sandboxPolicySchema.parse({
  enabled: true,
  onUnavailable: "degrade",
  resources: {
    cpuSeconds: 60,
    memoryBytes: 512 * 1024 * 1024,
    maxOpenFiles: 1024,
    maxProcesses: 256,
    maxOutputBytes: 5 * 1024 * 1024,
    maxFileSizeBytes: 256 * 1024 * 1024,
  },
  filesystem: { mode: "scratch-plus-ro" },
  network: { mode: "allowlist", allow: [], denyLinkLocalAndMetadata: true },
  privilege: { mode: "drop-to-uid" },
});

describe("DEFAULT_SANDBOX_FORM (UI seed default)", () => {
  it("is FAIL-CLOSED by default (onUnavailable=fail, never silent degrade)", () => {
    // The editor opens on this seed for a fresh global policy; it must default
    // to refusing the run when a layer can't be enforced, matching the shipped
    // backend secure default.
    expect(DEFAULT_SANDBOX_FORM.onUnavailable).toBe("fail");
  });

  it("is a valid, secure-by-default policy input", () => {
    const input = formToPolicyInput(DEFAULT_SANDBOX_FORM);
    const parsed = sandboxPolicySchema.safeParse(input);
    expect(parsed.success).toBe(true);
    // Secure-by-default: egress denied (empty allowlist), FS confined,
    // privilege dropped.
    expect(input.enabled).toBe(true);
    expect(input.onUnavailable).toBe("fail");
    expect(input.network?.mode).toBe("allowlist");
    expect(input.network?.allow).toEqual([]);
    expect(input.filesystem?.mode).toBe("scratch-plus-ro");
    expect(input.privilege?.mode).toBe("drop-to-uid");
  });
});

describe("policyToForm / formToPolicyInput round-trip", () => {
  it("round-trips the safe default without drift", () => {
    const form = policyToForm(SAFE_DEFAULT);
    const back = sandboxPolicySchema.parse(formToPolicyInput(form));
    expect(back).toEqual(SAFE_DEFAULT);
  });

  it("MB fields convert to bytes correctly", () => {
    const form = policyToForm(SAFE_DEFAULT);
    expect(form.memoryMb).toBe("512");
    const input = formToPolicyInput(form);
    expect(input.resources?.memoryBytes).toBe(512 * 1024 * 1024);
  });

  it("blank resource caps are omitted (unset, not zero)", () => {
    const form: SandboxFormState = {
      ...policyToForm(SAFE_DEFAULT),
      cpuSeconds: "",
      memoryMb: "",
    };
    const input = formToPolicyInput(form);
    expect(input.resources?.cpuSeconds).toBeUndefined();
    expect(input.resources?.memoryBytes).toBeUndefined();
    // Still valid (unset caps allowed).
    expect(sandboxPolicySchema.safeParse(input).success).toBe(true);
  });
});

describe("parseAllowList", () => {
  it("trims, drops blanks, keeps order", () => {
    expect(parseAllowList(" 10.0.0.1 \n\n 192.168.0.0/24\n")).toEqual([
      "10.0.0.1",
      "192.168.0.0/24",
    ]);
  });

  it("network mode + allow list survive form round-trip", () => {
    const form: SandboxFormState = {
      ...policyToForm(SAFE_DEFAULT),
      networkMode: "allowlist",
      allowText: "10.0.0.1\n203.0.113.0/24",
    };
    const input = formToPolicyInput(form);
    expect(input.network?.mode).toBe("allowlist");
    expect(input.network?.allow).toEqual(["10.0.0.1", "203.0.113.0/24"]);
  });
});

describe("validateForm", () => {
  it("returns null for a valid form", () => {
    expect(validateForm(policyToForm(SAFE_DEFAULT))).toBeNull();
  });

  it("flags a non-positive resource cap before submit", () => {
    const form: SandboxFormState = {
      ...policyToForm(SAFE_DEFAULT),
      cpuSeconds: "-5",
    };
    expect(validateForm(form)).not.toBeNull();
  });

  it("a global disable still produces a valid input", () => {
    const form: SandboxFormState = {
      ...policyToForm(SAFE_DEFAULT),
      enabled: false,
    };
    expect(validateForm(form)).toBeNull();
    expect(formToPolicyInput(form).enabled).toBe(false);
  });
});
