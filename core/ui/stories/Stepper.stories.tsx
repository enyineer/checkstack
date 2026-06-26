import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../src/components/Button";
import {
  Stepper,
  useStepper,
  type StepperStep,
} from "../src/components/Stepper";

const steps: StepperStep[] = [
  {
    id: "connect",
    title: "Connect source",
    description: "Point Checkstack at the endpoint to probe.",
  },
  {
    id: "assertions",
    title: "Add assertions",
    description: "Decide what a healthy response looks like.",
  },
  {
    id: "notify",
    title: "Notifications",
    description: "Where to send alerts.",
    optional: true,
  },
  {
    id: "review",
    title: "Review",
    description: "Confirm and create the check.",
  },
];

const meta: Meta<typeof Stepper> = {
  title: "Components/Navigation/Stepper",
  component: Stepper,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Stepper>;

export const MidFlow: Story = {
  render: () => (
    <div className="max-w-2xl">
      <Stepper steps={steps} activeStep={1} />
    </div>
  ),
};

export const FirstStep: Story = {
  render: () => (
    <div className="max-w-2xl">
      <Stepper steps={steps} activeStep={0} />
    </div>
  ),
};

// Hook-using demos are extracted into real components so they satisfy the
// rules-of-hooks lint (a story `render` arrow is not recognised as a component).
function NavigableBackDemo() {
  const [active, setActive] = useState(3);
  return (
    <div className="max-w-2xl">
      <Stepper steps={steps} activeStep={active} onStepSelect={setActive} />
      <p className="mt-6 text-sm text-muted-foreground">
        Completed steps are clickable - jump back to step {active + 1}.
      </p>
    </div>
  );
}

function InteractiveDemo() {
  const stepper = useStepper({ count: steps.length });
  return (
    <div className="max-w-2xl space-y-6">
      <Stepper
        steps={steps}
        activeStep={stepper.activeStep}
        onStepSelect={stepper.goTo}
      />
      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          onClick={stepper.back}
          disabled={stepper.isFirst}
        >
          Back
        </Button>
        <Button onClick={stepper.next} disabled={stepper.isLast}>
          {stepper.isLast ? "Done" : "Next"}
        </Button>
      </div>
    </div>
  );
}

export const NavigableBack: Story = {
  name: "Navigable (click a completed step)",
  render: () => <NavigableBackDemo />,
};

export const Interactive: Story = {
  name: "Interactive (useStepper)",
  render: () => <InteractiveDemo />,
};
