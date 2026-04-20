import React, { createContext, useContext, useEffect, useState } from "react";

interface PerformanceContextValue {
  /** 
   * Whether the device is considered low-power or lacks hardware acceleration.
   * If true, expensive animations, blurs, and transitions should be disabled.
   */
  isLowPower: boolean;
  /** Whether the performance detection has completed */
  isLoaded: boolean;
}

const PerformanceContext = createContext<PerformanceContextValue>({
  isLowPower: false,
  isLoaded: false,
});

/**
 * usePerformance - Hook to access the global hardware performance state.
 * Use this to conditionally disable heavy visual effects.
 */
export const usePerformance = () => useContext(PerformanceContext);

interface PerformanceProviderProps {
  children: React.ReactNode;
}

/**
 * PerformanceProvider - Centralizes detection of hardware capabilities and user preferences.
 * Runs a suite of heuristics (Media Queries, WebGL Audit, and Canvas Benchmarks) 
 * once on mount and provides the result to the entire application.
 */
export const PerformanceProvider: React.FC<PerformanceProviderProps> = ({ children }) => {
  const [state, setState] = useState<PerformanceContextValue>({
    isLowPower: false,
    isLoaded: false,
  });

  useEffect(() => {
    const runPerformanceChecks = () => {
      // 1. Accessibility Override (Reduced Motion)
      const prefersReducedMotion = globalThis.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      // 2. Hardware Hint Check (Low RAM or CPU Cores)
      const nav = globalThis.navigator as Navigator & { deviceMemory?: number };
      const isLowEndHardware =
        (nav.deviceMemory !== undefined && nav.deviceMemory < 4) ||
        nav.hardwareConcurrency <= 2;

      // 3. Renderer Audit (Detecting Software Rasterizers)
      let isSoftwareRenderer = false;
      try {
        const canvas = document.createElement("canvas");
        const gl =
          canvas.getContext("webgl") ||
          canvas.getContext("experimental-webgl");
        
        if (gl instanceof WebGLRenderingContext) {
          const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
          const renderer = (
            debugInfo
              ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER) || ""
          ).toLowerCase();

          isSoftwareRenderer = [
            "software",
            "swiftshader",
            "llvmpipe",
            "softpipe",
            "swrast",
            "osmesa",
            "mesa off-screen",
            "basic render",
            "warp",
            "driver", // Catch-all for generic software drivers
            "generic",
            "microsoft", // Microsoft Basic Render Driver
          ].some((id) => renderer.includes(id)) || renderer === ""; // Empty renderer usually means disabled/untrusted
          
          // Debugging: Log the actual renderer string to see what we're missing
          console.log(`[PerformanceAudit] Data: { renderer: "${renderer}" }`);
        } else {
          isSoftwareRenderer = true;
        }
      } catch {
        isSoftwareRenderer = true;
      }

      // 4. Empirical Benchmark (Stress Test)
      let isSlow = false;
      let rawDuration = 0;
      try {
        const benchCanvas = document.createElement("canvas");
        benchCanvas.width = 100;
        benchCanvas.height = 100;
        const ctx = benchCanvas.getContext("2d");
        if (ctx) {
          // Warm-up
          ctx.filter = "blur(20px)";
          ctx.fillRect(0, 0, 1, 1);
          ctx.getImageData(0, 0, 1, 1);

          const t0 = globalThis.performance.now();
          ctx.filter = "blur(20px)";
          for (let i = 0; i < 50; i++) {
            ctx.fillRect(i, i, 5, 5);
          }
          ctx.getImageData(0, 0, 1, 1);
          const t1 = globalThis.performance.now();
          rawDuration = t1 - t0;
          
          /**
           * PERFORMANCE THRESHOLD: 35ms
           * Adjusted to be more sensitive to software fallback on high-core CPUs.
           * Your 16ms with HW off suggests we should tighten this slightly, 
           * but keep it above the 15ms "healthy" Firefox result.
           */
          isSlow = rawDuration > 35; 
        }
      } catch {
        isSlow = true;
      }

      // Final Verdict
      const isLowPowerVerdict = 
        prefersReducedMotion || 
        isSoftwareRenderer ||   
        (isLowEndHardware && isSlow) ||
        isSlow; // If the benchmark fails (even on "good" hardware), it's low power
      
      // Detailed Debug Logging
      console.group("Checkstack Performance Audit");
      console.log("Verdict:", isLowPowerVerdict ? "LOW POWER (Animations Restricted)" : "HIGH PERFORMANCE (Animations Enabled)");
      console.log("Heuristics:", {
        prefersReducedMotion,
        isLowEndHardware,
        isSoftwareRenderer,
        isSlow,
      });
      console.log("Hardware Details:", {
        deviceMemory: nav.deviceMemory,
        hardwareConcurrency: nav.hardwareConcurrency,
        benchmarkDuration: `${rawDuration.toFixed(2)}ms`
      });
      console.groupEnd();
      
      setState({
        isLowPower: isLowPowerVerdict,
        isLoaded: true,
      });
    };

    runPerformanceChecks();
  }, []);

  return (
    <PerformanceContext.Provider value={state}>
      {children}
    </PerformanceContext.Provider>
  );
};
