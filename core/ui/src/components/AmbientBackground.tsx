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
          className="aurora-blob absolute w-[50%] h-[50%] -top-[10%] -left-[10%]"
          style={{
            background:
              "radial-gradient(circle at center, hsl(var(--primary) / 0.8), transparent 60%)",
            animation: "aurora-float-1 25s ease-in-out infinite",
          }}
        />
        <div
          className="aurora-blob absolute w-[40%] h-[40%] bottom-[10%] right-[10%]"
          style={{
            background:
              "radial-gradient(circle at center, hsl(var(--chart-2) / 0.7), transparent 60%)",
            animation: "aurora-float-2 20s ease-in-out infinite",
          }}
        />
        <div
          className="aurora-blob absolute w-[35%] h-[35%] top-[30%] left-[40%]"
          style={{
            background:
              "radial-gradient(circle at center, hsl(var(--primary) / 0.6), transparent 60%)",
            animation: "aurora-float-3 30s ease-in-out infinite",
          }}
        />
        <div
          className="aurora-blob absolute w-[45%] h-[45%] bottom-[20%] left-[10%]"
          style={{
            background:
              "radial-gradient(circle at center, hsl(var(--chart-1) / 0.5), transparent 60%)",
            animation: "aurora-float-4 35s ease-in-out infinite",
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
        {/* Layer 1: Aurora Blobs (Bottom) */}
        {auroraBlobs}

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
