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
              : gl.getParameter(gl.RENDERER)
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
          ].some((id) => renderer.includes(id));
        } else {
          // No WebGL support at all usually implies old/stripped browser
          isSoftwareRenderer = true;
        }
      } catch {
        isSoftwareRenderer = true;
      }

      // 4. Empirical Benchmark (Stress Test)
      let isSlow = false;
      try {
        const benchCanvas = document.createElement("canvas");
        benchCanvas.width = 100;
        benchCanvas.height = 100;
        const ctx = benchCanvas.getContext("2d");
        if (ctx) {
          const t0 = globalThis.performance.now();
          ctx.filter = "blur(20px)";
          for (let i = 0; i < 50; i++) {
            ctx.fillRect(i, i, 5, 5);
          }
          // Force pipeline sync to measure actual drawing time
          ctx.getImageData(0, 0, 1, 1);
          const t1 = globalThis.performance.now();
          isSlow = t1 - t0 > 4; // Threshold for CPU-based rasterization
        }
      } catch {
        isSlow = true;
      }

      const isLowPowerVerdict = prefersReducedMotion || isLowEndHardware || isSoftwareRenderer || isSlow;
      
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
