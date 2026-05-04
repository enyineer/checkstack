import type { Meta, StoryObj } from "@storybook/react";
import { Info } from "lucide-react";
import {
  InfoBanner,
  InfoBannerContent,
  InfoBannerDescription,
  InfoBannerIcon,
  InfoBannerTitle,
} from "../src/components/InfoBanner";

const meta: Meta<typeof InfoBanner> = {
  title: "Components/Feedback/InfoBanner",
  component: InfoBanner,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "info", "warning", "success", "error"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof InfoBanner>;

export const Default: Story = {
  args: { variant: "info" },
  render: (args) => (
    <InfoBanner {...args}>
      <InfoBannerIcon>
        <Info className="h-4 w-4" />
      </InfoBannerIcon>
      <InfoBannerContent>
        <InfoBannerTitle>Heads up</InfoBannerTitle>
        <InfoBannerDescription>
          This is a soft, low-emphasis banner used inline within content.
        </InfoBannerDescription>
      </InfoBannerContent>
    </InfoBanner>
  ),
};
