/**
 * Portable runner-side output truncation. Enforces `maxOutputBytes` by
 * counting the combined byte length of captured stdout+stderr and trimming
 * once the cap is exceeded. Works identically on every platform (pure JS),
 * so it is the portable-subset fallback for the resource layer (plan §5.1).
 */

const encoder = new TextEncoder();

export interface TruncateOutputResult {
  stdout: string;
  stderr: string;
  /** True when the combined output exceeded the cap and was trimmed. */
  truncated: boolean;
}

/**
 * Trim `stdout`/`stderr` so their combined UTF-8 byte length does not exceed
 * `maxOutputBytes`. stdout is preserved first; stderr gets whatever budget
 * remains. When `maxOutputBytes` is undefined the inputs pass through
 * unchanged.
 */
export function truncateCapturedOutput({
  stdout,
  stderr,
  maxOutputBytes,
}: {
  stdout: string;
  stderr: string;
  maxOutputBytes: number | undefined;
}): TruncateOutputResult {
  if (maxOutputBytes === undefined) {
    return { stdout, stderr, truncated: false };
  }

  const stdoutBytes = encoder.encode(stdout).length;
  const stderrBytes = encoder.encode(stderr).length;
  if (stdoutBytes + stderrBytes <= maxOutputBytes) {
    return { stdout, stderr, truncated: false };
  }

  // Give stdout up to the full budget, then stderr the remainder.
  const trimmedStdout = trimToBytes(stdout, maxOutputBytes);
  const stdoutFinalBytes = encoder.encode(trimmedStdout).length;
  const stderrBudget = Math.max(0, maxOutputBytes - stdoutFinalBytes);
  const trimmedStderr = trimToBytes(stderr, stderrBudget);

  return { stdout: trimmedStdout, stderr: trimmedStderr, truncated: true };
}

/**
 * Trim a string to at most `maxBytes` UTF-8 bytes without splitting a
 * multi-byte code point. Falls back to a character-wise walk only when a
 * fast slice would land mid-character.
 */
function trimToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (encoder.encode(value).length <= maxBytes) return value;

  let result = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = encoder.encode(char).length;
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result;
}
