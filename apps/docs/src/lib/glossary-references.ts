import fs from "fs";
import path from "path";
import { glossary, getAllTermsAndAliases, findGlossaryEntry } from "./glossary";

export interface PageReference {
  title: string;
  url: string;
}

export type GlossaryReferences = Map<string, PageReference[]>;

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

interface ContentFile {
  filePath: string;
  title: string;
  url: string;
  content: string;
}

function extractFrontmatter(content: string): {
  title?: string;
  content: string;
} {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { content };
  }

  const frontmatter = frontmatterMatch[1];
  const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
  const title = titleMatch
    ? titleMatch[1].trim().replace(/^["']|["']$/g, "")
    : undefined;

  return {
    title,
    content: content.slice(frontmatterMatch[0].length),
  };
}

function getContentFiles(contentDir: string): ContentFile[] {
  const files: ContentFile[] = [];

  function scanDir(dir: string, urlPrefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDir(fullPath, `${urlPrefix}/${entry.name}`);
      } else if (entry.name.endsWith(".mdx")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const { title, content: bodyContent } = extractFrontmatter(content);

        // Skip the glossary page itself
        if (fullPath.includes("glossary.mdx")) {
          continue;
        }

        // Build URL from file path
        const fileName = entry.name.replace(/\.mdx$/, "");
        const url =
          fileName === "index" ? urlPrefix : `${urlPrefix}/${fileName}`;

        files.push({
          filePath: fullPath,
          title: title ?? fileName,
          url,
          content: bodyContent,
        });
      }
    }
  }

  scanDir(contentDir, "");
  return files;
}

export function buildGlossaryReferences(): GlossaryReferences {
  const references: GlossaryReferences = new Map();

  // Initialize map with all glossary terms
  glossary.forEach((entry) => {
    references.set(entry.term.toLowerCase(), []);
  });

  // Find content directory
  const contentDir = path.join(process.cwd(), "content/docs");

  if (!fs.existsSync(contentDir)) {
    console.warn("Content directory not found:", contentDir);
    return references;
  }

  const termPattern = buildTermPattern();
  const files = getContentFiles(contentDir);

  for (const file of files) {
    // Find all glossary terms in this file
    const foundTerms = new Set<string>();
    let match;
    termPattern.lastIndex = 0;

    while ((match = termPattern.exec(file.content)) !== null) {
      const entry = findGlossaryEntry(match[0]);
      if (entry) {
        foundTerms.add(entry.term.toLowerCase());
      }
    }

    // Add this page to each found term's references
    for (const termKey of foundTerms) {
      const pageRefs = references.get(termKey);
      if (pageRefs) {
        pageRefs.push({
          title: file.title,
          url: file.url,
        });
      }
    }
  }

  return references;
}

// Serialize references for passing to client components
export function serializeReferences(
  refs: GlossaryReferences
): Record<string, PageReference[]> {
  const result: Record<string, PageReference[]> = {};
  refs.forEach((pages, term) => {
    result[term] = pages;
  });
  return result;
}
