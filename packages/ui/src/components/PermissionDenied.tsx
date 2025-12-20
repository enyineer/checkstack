import React from "react";
import { ShieldAlert } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./Card";
import { cn } from "../utils";

export const PermissionDenied: React.FC<{
  message?: string;
  className?: string;
}> = ({
  message = "You do not have permission to view this page.",
  className,
}) => {
  return (
    <div
      className={cn(
        "flex items-center justify-center min-h-[50vh] p-4",
        className
      )}
    >
      <Card className="max-w-md w-full border-red-200 bg-red-50">
        <CardHeader className="flex flex-row items-center gap-4 pb-2">
          <ShieldAlert className="w-8 h-8 text-red-600" />
          <CardTitle className="text-red-700">Access Denied</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-600">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
};
