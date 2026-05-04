import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../src/components/Badge";
import {
  StatusUpdateTimeline,
  Timeline,
  type StatusUpdate,
} from "../src/components/StatusUpdateTimeline";

const meta: Meta = {
  title: "Components/Display/StatusUpdateTimeline",
};

export default meta;
type Story = StoryObj;

type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

const updates: StatusUpdate<IncidentStatus>[] = [
  {
    id: "1",
    message: "We are investigating reports of elevated 5xx on /api.",
    statusChange: "investigating",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3),
    createdByName: "On-call",
  },
  {
    id: "2",
    message: "Identified a misconfigured rate limiter; rolling back.",
    statusChange: "identified",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
    createdByName: "On-call",
  },
  {
    id: "3",
    message: "Rollback completed. Monitoring error rate.",
    statusChange: "monitoring",
    createdAt: new Date(Date.now() - 1000 * 60 * 60),
    createdByName: "On-call",
  },
  {
    id: "4",
    message: "Resolved.",
    statusChange: "resolved",
    createdAt: new Date(Date.now() - 1000 * 60 * 30),
    createdByName: "On-call",
  },
];

export const Updates: Story = {
  render: () => (
    <div className="max-w-xl">
      <StatusUpdateTimeline
        updates={updates}
        renderStatusBadge={(status) => (
          <Badge variant={status === "resolved" ? "success" : "secondary"}>
            {status}
          </Badge>
        )}
      />
    </div>
  ),
};

export const GenericTimeline: Story = {
  render: () => (
    <div className="max-w-xl">
      <Timeline
        items={updates.map((u) => ({ id: u.id, date: u.createdAt, msg: u.message }))}
        renderItem={(item) => (
          <div className="rounded-md border border-border p-3">
            <p className="text-sm">{item.msg}</p>
          </div>
        )}
      />
    </div>
  ),
};
