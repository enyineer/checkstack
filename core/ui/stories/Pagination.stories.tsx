import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Pagination } from "../src/components/Pagination";

const meta: Meta<typeof Pagination> = {
  title: "Components/Navigation/Pagination",
  component: Pagination,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Pagination>;

const Demo = () => {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  return (
    <Pagination
      page={page}
      totalPages={12}
      onPageChange={setPage}
      total={234}
      limit={limit}
      onPageSizeChange={setLimit}
      showPageSize
      showTotal
    />
  );
};

export const Default: Story = { render: () => <Demo /> };
