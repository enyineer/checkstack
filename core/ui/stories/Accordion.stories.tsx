import type { Meta, StoryObj } from "@storybook/react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../src/components/Accordion";

const meta: Meta<typeof Accordion> = {
  title: "Components/Display/Accordion",
  component: Accordion,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Accordion>;

export const Single: Story = {
  render: () => (
    <Accordion type="single" collapsible className="max-w-md">
      <AccordionItem value="a">
        <AccordionTrigger>What is a health check?</AccordionTrigger>
        <AccordionContent>
          A periodic probe that asserts a system property and reports a status.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>What is a strategy?</AccordionTrigger>
        <AccordionContent>
          A pluggable provider that defines how a check is executed.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="c">
        <AccordionTrigger>What is a satellite?</AccordionTrigger>
        <AccordionContent>
          A standalone agent that runs checks from a remote network location.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  render: () => (
    <Accordion type="multiple" className="max-w-md">
      <AccordionItem value="a">
        <AccordionTrigger>Section one</AccordionTrigger>
        <AccordionContent>Content one.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Section two</AccordionTrigger>
        <AccordionContent>Content two.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
