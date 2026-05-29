import React from "react";
import { TableRow, TableCell } from "@checkstack/ui";

interface EmptyRunsTableRowProps {
  /** Number of columns in the parent table (drives `colSpan`). */
  colSpan: number;
  /** Message to display in the empty cell. Plain strings or rich nodes. */
  children: React.ReactNode;
}

/**
 * Single-row empty state rendered inside a runs table body. Centralises
 * the look so the drawer's Recent Runs and the Run History page can
 * share the same in-table empty state.
 */
export function EmptyRunsTableRow({ colSpan, children }: EmptyRunsTableRowProps) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className="text-center text-xs text-muted-foreground py-6"
      >
        {children}
      </TableCell>
    </TableRow>
  );
}
