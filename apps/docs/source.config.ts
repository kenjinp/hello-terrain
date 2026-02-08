import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from "fumadocs-mdx/config";
import { remarkGlossary } from "./src/lib/remark-glossary";
import { z } from "zod";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections#define-docs
export const docs = defineDocs({
  docs: {
    schema: frontmatterSchema.extend({
      // Optional for general docs, but enforced at the page level for blog posts
      publishDate: z.coerce.date().optional(),
      authors: z.array(z.string()).optional(),
      image: z.string().optional(),
    }),
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkGlossary],
  },
});
