import { useNavigate } from "react-router";
import { Info } from "lucide-react";
import { DropdownMenuItem } from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import { aboutRoutes } from "./index";

export function AboutMenuItem() {
  const navigate = useNavigate();

  return (
    <DropdownMenuItem
      onClick={() => navigate(resolveRoute(aboutRoutes.routes.page))}
      icon={<Info className="h-4 w-4" />}
    >
      About Checkstack
    </DropdownMenuItem>
  );
}
