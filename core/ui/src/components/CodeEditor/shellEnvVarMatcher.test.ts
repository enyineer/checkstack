import { describe, expect, it } from "bun:test";
import {
  matchShellEnvVarTrigger,
  buildShellEnvVarInsertText,
} from "./shellEnvVarMatcher";

describe("matchShellEnvVarTrigger", () => {
  it("returns null for an empty line", () => {
    expect(matchShellEnvVarTrigger("")).toBeNull();
  });

  it("returns null when the cursor is not at a `$`-prefixed reference", () => {
    expect(matchShellEnvVarTrigger("echo hello")).toBeNull();
    expect(matchShellEnvVarTrigger("echo $FOO ")).toBeNull(); // whitespace breaks the ident
    expect(matchShellEnvVarTrigger("echo ${FOO} bar")).toBeNull();
  });

  it("recognises a bare `$` with no query yet", () => {
    expect(matchShellEnvVarTrigger("echo $")).toEqual({
      form: "bare",
      query: "",
      prefixLength: 1,
    });
  });

  it("recognises a bare reference with a partial name", () => {
    expect(matchShellEnvVarTrigger("echo $EV")).toEqual({
      form: "bare",
      query: "EV",
      prefixLength: 3,
    });
  });

  it("uppercases the query so case-insensitive matching works downstream", () => {
    expect(matchShellEnvVarTrigger("echo $payload_ti")).toEqual({
      form: "bare",
      query: "PAYLOAD_TI",
      prefixLength: 11,
    });
  });

  it("recognises a braced `${` with no query yet", () => {
    expect(matchShellEnvVarTrigger("echo ${")).toEqual({
      form: "braced",
      query: "",
      prefixLength: 2,
    });
  });

  it("recognises a braced reference with a partial name", () => {
    expect(matchShellEnvVarTrigger("echo ${PAY")).toEqual({
      form: "braced",
      query: "PAY",
      prefixLength: 5,
    });
  });

  it("prefers the braced form when both could match", () => {
    // `echo ${FOO` — the `$` is part of `${`, so we must NOT report as bare.
    const match = matchShellEnvVarTrigger("echo ${FOO");
    expect(match?.form).toBe("braced");
    expect(match?.query).toBe("FOO");
  });

  it("accepts underscores and digits in identifiers (shell-name-rule)", () => {
    expect(matchShellEnvVarTrigger("echo $FOO_1")?.query).toBe("FOO_1");
    expect(matchShellEnvVarTrigger("echo $_HIDDEN")?.query).toBe("_HIDDEN");
  });

  it("stops at non-identifier characters", () => {
    // The `.` after FOO is not a valid identifier char, so we treat the
    // cursor position as not being inside an env-var reference.
    expect(matchShellEnvVarTrigger("echo $FOO.")).toBeNull();
  });
});

describe("buildShellEnvVarInsertText", () => {
  it("produces a bare `$NAME` for the bare form", () => {
    expect(
      buildShellEnvVarInsertText(
        { form: "bare", query: "", prefixLength: 1 },
        "EVENT_ID",
      ),
    ).toBe("$EVENT_ID");
  });

  it("produces a `${NAME}` for the braced form", () => {
    expect(
      buildShellEnvVarInsertText(
        { form: "braced", query: "", prefixLength: 2 },
        "EVENT_ID",
      ),
    ).toBe("${EVENT_ID}");
  });
});
