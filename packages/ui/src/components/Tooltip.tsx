import React from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "../utils";

export interface TooltipProps {
  content: string;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, className }) => {
  return (
    <div className={cn("group relative inline-block", className)}>
      <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help hover:text-indigo-600 transition-colors" />
      <div className="invisible group-hover:visible absolute z-[100] bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-900 text-white text-xs rounded shadow-lg transition-all opacity-0 group-hover:opacity-100">
        {content}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900" />
      </div>
    </div>
  );
};
