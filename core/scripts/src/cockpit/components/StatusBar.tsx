/** @jsxImportSource @opentui/react */

/** A single-line footer of `key  description` hints. */
export function StatusBar({ hints }: { hints: readonly string[] }) {
  return (
    <box borderStyle="single" border paddingLeft={1} paddingRight={1}>
      <text fg="gray">{hints.join("   ")}</text>
    </box>
  );
}
