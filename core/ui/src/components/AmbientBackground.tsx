import React, { useMemo } from "react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

interface AmbientBackgroundProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * AmbientBackground - Premium background with performance-aware fallbacks.
 * Features an "Inverse Glow Grid" where aurora effects shine through transparency.
 * Automatically downgrades to a static grid on devices that struggle with CSS blurs.
 */
export const AmbientBackground: React.FC<AmbientBackgroundProps> = ({
  children,
  className,
}) => {
  const { isLowPower } = usePerformance();

  // Optimized Aurora Layers - only render if not in low power mode
  const auroraBlobs = useMemo(() => {
    if (isLowPower) return;
    return (
      <>
        <div
          className="aurora-blob absolute w-[100%] h-[100%] -top-[40%] -left-[20%]"
          style={{
            background:
              "radial-gradient(circle at center, hsl(var(--primary) / 0.9) 0%, hsl(var(--primary) / 0.3) 50%, transparent 90%)",
            animation: "aurora-float-1 60s ease-in-out infinite",
          }}
        />
        <div
          className="aurora-blob absolute w-[90%] h-[90%] -bottom-[30%] -right-[20%]"
          style={{
            background:
              "radial-gradient(circle at center, hsl(var(--chart-2) / 0.8) 0%, hsl(var(--chart-2) / 0.2) 50%, transparent 90%)",
            animation: "aurora-float-2 50s ease-in-out infinite",
          }}
        />
      </>
    );
  }, [isLowPower]);

  return (
    <div
      className={cn(
        "relative min-h-screen bg-background overflow-hidden",
        className,
      )}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Layer 1: Aurora Blobs (Bottom) - Centered in content area */}
        <div className="max-w-7xl mx-auto h-full relative">
          {auroraBlobs}
        </div>

        {/* Layer 2: Grid Mask - Switches mode based on performance capability */}
        <div
          className={cn(
            isLowPower ? "ambient-grid" : "ambient-grid-inverse",
            "absolute inset-0 overflow-hidden",
          )}
        />
      </div>

      {/* Layer 3: Edge vignette fade */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: `
            linear-gradient(to right, hsl(var(--background)) 0%, transparent 15%, transparent 85%, hsl(var(--background)) 100%),
            linear-gradient(to bottom, hsl(var(--background)) 0%, transparent 15%, transparent 85%, hsl(var(--background)) 100%)
          `,
        }}
      />

      <div className="relative z-10">{children}</div>
    </div>
  );
};
