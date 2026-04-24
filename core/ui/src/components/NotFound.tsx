import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

/** Rotating tech-insider quips shown on the 404 page. */
const NOT_FOUND_QUIPS = [
  // DevOps / infra humor
  "Looks like this route didn't pass the health check.",
  "This endpoint has an uptime of exactly 0%.",
  "We checked the stack. This page isn't in it.",
  "Our monitoring confirms: this page is down. Permanently.",
  "This page was last seen in a git stash from 2019.",
  String.raw`Incident report: page not found. Severity: ¯\_(ツ)_/¯`,
  "DNS resolved. TCP connected. Page? Gone.",
  "kubectl get page — error: resource not found.",
  "This page is in a pending state. It may never resolve.",
  "The deployment was successful. The page was not.",
  "This route has been deprecated without notice.",
  "Alert triggered: page_exists = false.",
  // Programming jokes
  "The page you're looking for is in another castle.",
  "404: The page was found, then garbage collected.",
  "Segfault at 0x00000404.",
  "The page exists in the dev environment, we promise.",
  "Works on my machine ™",
  "Have you tried turning the URL off and on again?",
  "This page is not a bug, it's an undocumented feature.",
  "Error 404: Coffee not found. Page also missing.",
  "git log --all --oneline | grep 'this page' → no results.",
  // Pop culture references
  "These aren't the pages you're looking for. — Obi-Wan Kenobi",
  "I am inevitable. This page is not. — Thanos",
  "One does not simply navigate to a page that doesn't exist.",
  "In case I don't see ya: good afternoon, good evening, and good 404.",
  "It's a feature, not a bug. — Every PM ever",
  "Ah yes, the 404. The page that lived… briefly.",
  "I've seen things you people wouldn't believe. But not this page.",
  "To 404, or not to 404. That is the question.",
  "Houston, we have a 404.",
] as const;

export const NotFound: React.FC<{
  message?: string;
  className?: string;
}> = ({ message, className }) => {
  const { isLowPower } = usePerformance();
  const navigate = useNavigate();
  const [hasFallen, setHasFallen] = useState(false);

  const quip = useMemo(
    () =>
      message ??
      NOT_FOUND_QUIPS[Math.floor(Math.random() * NOT_FOUND_QUIPS.length)],
    [message],
  );

  useEffect(() => {
    if (isLowPower) return;
    const timer = setTimeout(() => setHasFallen(true), 1800);
    return () => clearTimeout(timer);
  }, [isLowPower]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center min-h-[60vh] p-8 select-none overflow-hidden",
        className,
      )}
    >
      {/* Physics keyframes for the falling "4" */}
      {!isLowPower && (
        <style>{`
          @keyframes wobble-fall {
            0%   { transform: rotate(0deg) translateY(0); }
            15%  { transform: rotate(-2deg) translateY(0); }
            30%  { transform: rotate(3deg) translateY(0); }
            42%  { transform: rotate(6deg) translateY(2px); }
            65%  { transform: rotate(55deg) translateY(30px); }
            78%  { transform: rotate(80deg) translateY(50px); }
            86%  { transform: rotate(72deg) translateY(45px); }
            93%  { transform: rotate(78deg) translateY(52px); }
            100% { transform: rotate(76deg) translateY(50px); opacity: 0.25; }
          }
        `}</style>
      )}

      {/* 404 display */}
      <div className="relative mb-8">
        {/* Glow effect */}
        {!isLowPower && (
          <div
            className="absolute inset-0 blur-3xl opacity-15 bg-primary rounded-full scale-150"
            aria-hidden="true"
          />
        )}
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center">
          <span className="text-center text-[8rem] md:text-[12rem] font-black leading-none tabular-nums text-muted-foreground/50">
            4
          </span>
          {/* Checkstack logo as the "0" */}
          <div className="flex items-center justify-center w-28 h-28 md:w-44 md:h-44 mx-1 md:mx-3">
            <img
              src="/favicon.svg"
              alt=""
              aria-hidden="true"
              className="w-full h-full"
            />
          </div>
          <span
            className="text-center text-[8rem] md:text-[12rem] font-black leading-none tabular-nums text-muted-foreground/50"
            style={
              !isLowPower && hasFallen
                ? {
                    animation:
                      "wobble-fall 1.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards",
                    transformOrigin: "bottom left",
                  }
                : undefined
            }
          >
            4
          </span>
        </div>
      </div>

      {/* Text content */}
      <div className="text-center space-y-3 max-w-md">
        <h2 className="text-xl md:text-2xl font-semibold text-foreground">
          Route not found
        </h2>
        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
          {quip}
        </p>
      </div>

      {/* Action */}
      <button
        type="button"
        onClick={() => navigate("/")}
        className={cn(
          "mt-8 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer",
          "bg-primary/10 text-primary border border-primary/20",
          "hover:bg-primary/20 hover:border-primary/30",
          !isLowPower && "transition-colors duration-200",
        )}
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>
    </div>
  );
};
