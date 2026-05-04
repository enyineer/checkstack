import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useMemo } from "react";
import { PaginatedList } from "../src/components/PaginatedList";
import { usePagination } from "../src/hooks/usePagination";

const meta: Meta = {
  title: "Components/Data/PaginatedList",
};

export default meta;
type Story = StoryObj;

const ITEMS = Array.from({ length: 73 }, (_, i) => ({
  id: String(i + 1),
  name: `System ${i + 1}`,
}));

const Demo = () => {
  const pagination = usePagination({ defaultLimit: 10 });
  useEffect(() => {
    pagination.setTotal(ITEMS.length);
  }, [pagination]);
  const slice = useMemo(
    () => ITEMS.slice(pagination.offset, pagination.offset + pagination.limit),
    [pagination.offset, pagination.limit],
  );
  return (
    <div className="max-w-md">
      <PaginatedList items={slice} loading={false} pagination={pagination}>
        {(items) => (
          <ul className="divide-y rounded-md border border-border">
            {items.map((item) => (
              <li key={item.id} className="px-3 py-2 text-sm">
                {item.name}
              </li>
            ))}
          </ul>
        )}
      </PaginatedList>
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
