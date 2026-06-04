/**
 * POSIX single-quote shell escaping for argv fragments embedded into a
 * generated `sh` script (the rootless egress launcher). Wraps the value in
 * single quotes and escapes any embedded single quote via the standard
 * `'\''` idiom, so the result is safe to splice into a `sh -c` body or an
 * `exec` line regardless of its contents.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
