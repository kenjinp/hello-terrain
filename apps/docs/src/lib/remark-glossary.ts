import type { Root, Text, Parent } from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx-jsx";
import { visit } from "unist-util-visit";
import { findGlossaryEntry, getAllTermsAndAliases } from "./glossary";

// Build a regex pattern that matches any glossary term or alias
function buildTermPattern(): RegExp {
  const terms = getAllTermsAndAliases();
  // Sort by length (longest first) to match longer terms before shorter ones
  terms.sort((a, b) => b.length - a.length);
  // Escape special regex characters
  const escapedTerms = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  // Create pattern with word boundaries, case insensitive
  return new RegExp(`\\b(${escapedTerms.join("|")})\\b`, "gi");
}

const termPattern = buildTermPattern();

interface VisitorContext {
  processedTerms: Set<string>;
}

function createGlossaryNode(
  term: string,
  matchedText: string
): MdxJsxTextElement {
  return {
    type: "mdxJsxTextElement",
    name: "GlossaryTerm",
    attributes: [
      {
        type: "mdxJsxAttribute",
        name: "term",
        value: term,
      },
    ],
    children: [
      {
        type: "text",
        value: matchedText,
      },
    ],
  };
}

export function remarkGlossary() {
  return (tree: Root) => {
    const context: VisitorContext = {
      processedTerms: new Set(),
    };

    visit(
      tree,
      "text",
      (node: Text, index: number | undefined, parent: Parent | undefined) => {
        if (!parent || index === undefined) return;

        // Skip if we're inside a heading, link, code, or already a glossary term
        const parentType = parent.type;
        if (
          parentType === "heading" ||
          parentType === "link" ||
          parentType === "code" ||
          parentType === "inlineCode"
        ) {
          return;
        }

        // Skip if parent is a JSX element that's already a GlossaryTerm
        if (
          (parentType === "mdxJsxTextElement" ||
            parentType === "mdxJsxFlowElement") &&
          (parent as MdxJsxTextElement | MdxJsxFlowElement).name ===
            "GlossaryTerm"
        ) {
          return;
        }

        const text = node.value;
        const matches: Array<{
          index: number;
          length: number;
          term: string;
          matchedText: string;
        }> = [];

        // Find all matches
        let match;
        termPattern.lastIndex = 0;
        while ((match = termPattern.exec(text)) !== null) {
          const matchedText = match[0];
          const entry = findGlossaryEntry(matchedText);
          if (entry) {
            // Only link each unique term once per document
            const termKey = entry.term.toLowerCase();
            if (!context.processedTerms.has(termKey)) {
              matches.push({
                index: match.index,
                length: matchedText.length,
                term: entry.term,
                matchedText,
              });
              context.processedTerms.add(termKey);
            }
          }
        }

        if (matches.length === 0) return;

        // Build new children array with glossary terms wrapped
        const newChildren: (Text | MdxJsxTextElement)[] = [];
        let lastIndex = 0;

        for (const m of matches) {
          // Add text before the match
          if (m.index > lastIndex) {
            newChildren.push({
              type: "text",
              value: text.slice(lastIndex, m.index),
            });
          }

          // Add the glossary term node
          newChildren.push(createGlossaryNode(m.term, m.matchedText));

          lastIndex = m.index + m.length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
          newChildren.push({
            type: "text",
            value: text.slice(lastIndex),
          });
        }

        // Replace the text node with our new children
        parent.children.splice(index, 1, ...newChildren);
      }
    );
  };
}
