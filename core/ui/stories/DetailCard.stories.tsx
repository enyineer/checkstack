import type { Meta, StoryObj } from "@storybook/react";
import { DetailCard } from "../src/components/DetailCard";
import {
  CardHeader,
  CardTitle,
  CardContent,
} from "../src/components/Card";
import { LoadingSpinner } from "../src/components/LoadingSpinner";
import { ScrollText } from "lucide-react";

const meta: Meta<typeof DetailCard> = {
  title: "Components/Display/DetailCard",
  component: DetailCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The canonical elevated surface for cards on the system detail / overview page and the plugin cards contributed into its extension slots (Logs / Metrics / Traces, health, dependency, SLO, incident, anomaly, maintenance). Single-sources the chrome so those cards cannot drift apart, and is enforced by the `checkstack/no-inline-detail-card-chrome` ESLint rule.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DetailCard>;

export const Elevated: Story = {
  render: () => (
    <DetailCard className="max-w-md overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base font-semibold">Logs</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border/60">
          {["checkout-api", "payments-worker"].map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{name}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </DetailCard>
  ),
};

export const Flat: Story = {
  name: "Flat (loading / placeholder)",
  render: () => (
    <DetailCard
      surface="flat"
      className="flex max-w-md items-center justify-center px-3 py-2"
    >
      <LoadingSpinner />
    </DetailCard>
  ),
};

export const StatusTinted: Story = {
  name: "Status-tinted border override",
  render: () => (
    <DetailCard className="max-w-md border-status-warn/30 p-4">
      <p className="text-sm text-muted-foreground">
        A status-tinted border is a `className` override; the gradient and
        elevation shadow stay single-sourced.
      </p>
    </DetailCard>
  ),
};
