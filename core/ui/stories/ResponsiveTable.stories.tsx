import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../src/components/Badge";
import {
  MobileCardList,
  ResponsiveTable,
} from "../src/components/ResponsiveTable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/Table";

const meta: Meta = {
  title: "Components/Data/ResponsiveTable",
};

export default meta;
type Story = StoryObj;

interface Row {
  name: string;
  strategy: string;
  status: "healthy" | "degraded" | "down";
  latency: string;
}

const rows: Row[] = [
  { name: "api.checkstack.io", strategy: "HTTP probe", status: "healthy", latency: "42 ms" },
  { name: "db-primary", strategy: "TCP probe", status: "degraded", latency: "340 ms" },
  { name: "cache", strategy: "HTTP probe", status: "down", latency: "—" },
];

const variantFor = (status: Row["status"]) => {
  if (status === "healthy") return "success" as const;
  if (status === "degraded") return "warning" as const;
  return "destructive" as const;
};

export const DualLayout: Story = {
  render: () => (
    <div className="w-full">
      <ResponsiveTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.strategy}</TableCell>
                <TableCell>
                  <Badge variant={variantFor(row.status)}>{row.status}</Badge>
                </TableCell>
                <TableCell className="text-right">{row.latency}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ResponsiveTable>

      <MobileCardList>
        {rows.map((row) => (
          <div
            key={row.name}
            className="rounded-md border border-border bg-card p-3 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{row.name}</span>
              <Badge variant={variantFor(row.status)}>{row.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {row.strategy} · {row.latency}
            </div>
          </div>
        ))}
      </MobileCardList>

      <p className="text-xs text-muted-foreground mt-4">
        Resize the viewport: the table appears on <code>sm</code> and up, the
        stacked card list shows on smaller screens.
      </p>
    </div>
  ),
};
