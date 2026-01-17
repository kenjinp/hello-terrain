"use client";

import { glossary } from "@/lib/glossary";
import { GlossaryDefinition, type PageReference } from "./GlossaryTerm";

interface GlossaryListProps {
  references?: Record<string, PageReference[]>;
}

export function GlossaryList({ references }: GlossaryListProps) {
  // Sort entries alphabetically
  const sortedGlossary = [...glossary].sort((a, b) =>
    a.term.toLowerCase().localeCompare(b.term.toLowerCase())
  );

  return (
    <dl className="m-0 p-0">
      {sortedGlossary.map((entry) => (
        <GlossaryDefinition
          key={entry.term}
          entry={entry}
          references={references?.[entry.term.toLowerCase()]}
        />
      ))}
    </dl>
  );
}
