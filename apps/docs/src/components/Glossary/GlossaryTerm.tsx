"use client";

import { findGlossaryEntry, type GlossaryEntry } from "@/lib/glossary";
import Link from "next/link";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipPosition {
  top: number;
  left: number;
  placement: "above" | "below";
}

interface GlossaryTermProps {
  term: string;
  children?: ReactNode;
}

export function GlossaryTerm({ term, children }: GlossaryTermProps) {
  const entry = findGlossaryEntry(term);
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const termRef = useRef<HTMLAnchorElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTooltip && termRef.current) {
      const updatePosition = () => {
        if (!termRef.current) return;

        const rect = termRef.current.getBoundingClientRect();
        const tooltipHeight = tooltipRef.current?.offsetHeight ?? 100;
        const gap = 8;

        // Determine if tooltip should go above or below
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const placement = spaceAbove > tooltipHeight + gap ? "above" : "below";

        // Calculate position
        const left = rect.left + rect.width / 2;
        const top = placement === "above" ? rect.top - gap : rect.bottom + gap;

        setPosition({ top, left, placement });
      };

      updatePosition();

      // Update position on scroll/resize
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);

      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    } else {
      setPosition(null);
    }
  }, [showTooltip]);

  if (!entry) {
    return <span>{children ?? term}</span>;
  }

  const slug = entry.term.toLowerCase().replace(/\s+/g, "-");

  const tooltip = showTooltip && position && (
    <div
      ref={tooltipRef}
      role="tooltip"
      style={{
        position: "fixed",
        top: position.placement === "above" ? "auto" : position.top,
        bottom:
          position.placement === "above"
            ? window.innerHeight - position.top
            : "auto",
        left: position.left,
        transform: "translateX(-50%)",
      }}
      className={`
        pointer-events-none z-[9999] w-70 max-w-[90vw]
        rounded-lg border border-fd-border bg-fd-popover px-4 py-3
        shadow-[0_4px_16px_rgba(0,0,0,0.15)]
        ${
          position.placement === "above"
            ? "animate-glossary-tooltip-above"
            : "animate-glossary-tooltip-below"
        }
      `}
    >
      <strong className="mb-1 block text-sm font-semibold text-fd-primary">
        {entry.term}
      </strong>
      <p className="m-0 text-[0.8125rem] leading-relaxed text-fd-muted-foreground">
        {entry.definition}
      </p>
    </div>
  );

  return (
    <>
      <Link
        ref={termRef}
        href={`/docs/glossary#${slug}`}
        className="cursor-help text-inherit underline decoration-dotted decoration-fd-primary underline-offset-[3px] transition-[text-decoration-color] duration-150 ease-in-out hover:decoration-solid"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
      >
        {children ?? term}
      </Link>
      {typeof document !== "undefined" && createPortal(tooltip, document.body)}
    </>
  );
}

// Component for rendering term definitions on the glossary page
export interface PageReference {
  title: string;
  url: string;
}

interface GlossaryDefinitionProps {
  entry: GlossaryEntry;
  references?: PageReference[];
}

export function GlossaryDefinition({
  entry,
  references,
}: GlossaryDefinitionProps) {
  const slug = entry.term.toLowerCase().replace(/\s+/g, "-");

  return (
    <div
      id={slug}
      className="scroll-mt-[calc(var(--fd-nav-height,3.5rem)+1rem)] border-b border-fd-border py-4 last:border-b-0"
    >
      <dt className="mb-2 flex flex-wrap items-baseline gap-2 text-lg font-semibold text-fd-foreground">
        <a
          href={`#${slug}`}
          className="text-inherit no-underline hover:text-fd-primary"
        >
          {entry.term}
        </a>
        {entry.aliases && entry.aliases.length > 0 && (
          <span className="text-sm font-normal italic text-fd-muted-foreground">
            ({entry.aliases.join(", ")})
          </span>
        )}
      </dt>
      <dd className="m-0 leading-relaxed text-fd-muted-foreground">
        {entry.definition}
      </dd>
      {references && references.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-fd-muted-foreground">Referenced in:</span>
          {references.map((ref, index) => (
            <span key={ref.url} className="inline-flex items-center">
              <Link
                href={ref.url}
                className="rounded bg-fd-accent px-1.5 py-0.5 text-fd-accent-foreground no-underline transition-colors hover:bg-fd-primary hover:text-fd-primary-foreground"
              >
                {ref.title}
              </Link>
              {index < references.length - 1 && (
                <span className="text-fd-muted-foreground">,</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
