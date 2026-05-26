import { describe, expect, it } from "bun:test";
import { render } from "@checkstack/test-utils-frontend";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";
import { MobileCardList, ResponsiveTable } from "./ResponsiveTable";

const expectElement = (node: ChildNode | null): HTMLElement => {
  if (!(node instanceof HTMLElement)) {
    throw new Error("expected first child to be an HTMLElement");
  }
  return node;
};

describe("ResponsiveTable", () => {
  it("renders its tabular children without crashing", () => {
    const { getByText } = render(
      <ResponsiveTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>api.checkstack.io</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ResponsiveTable>,
    );

    expect(getByText("api.checkstack.io")).toBeDefined();
  });

  it("hides the desktop branch below the sm breakpoint via CSS classes", () => {
    const { container } = render(
      <ResponsiveTable>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>row</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ResponsiveTable>,
    );

    const wrapper = expectElement(container.firstChild);
    expect(wrapper.className).toContain("hidden");
    expect(wrapper.className).toContain("sm:block");
  });
});

describe("MobileCardList", () => {
  it("renders its card-shaped children without crashing", () => {
    const { getByText } = render(
      <MobileCardList>
        <div>api.checkstack.io card</div>
      </MobileCardList>,
    );

    expect(getByText("api.checkstack.io card")).toBeDefined();
  });

  it("hides the mobile branch above the sm breakpoint via CSS classes", () => {
    const { container } = render(
      <MobileCardList>
        <div>row</div>
      </MobileCardList>,
    );

    const wrapper = expectElement(container.firstChild);
    expect(wrapper.className).toContain("sm:hidden");
  });
});
