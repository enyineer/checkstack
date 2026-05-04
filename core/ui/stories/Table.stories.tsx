import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../src/components/Badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/Table";

const meta: Meta = {
  title: "Components/Data/Table",
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <div className="max-w-2xl">
      <Table>
        <TableCaption>Recent health checks</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Latency</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>api.checkstack.io</TableCell>
            <TableCell>HTTP probe</TableCell>
            <TableCell><Badge variant="success">Healthy</Badge></TableCell>
            <TableCell className="text-right">42 ms</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>db-primary</TableCell>
            <TableCell>TCP probe</TableCell>
            <TableCell><Badge variant="warning">Degraded</Badge></TableCell>
            <TableCell className="text-right">340 ms</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>cache</TableCell>
            <TableCell>HTTP probe</TableCell>
            <TableCell><Badge variant="destructive">Down</Badge></TableCell>
            <TableCell className="text-right">—</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};
