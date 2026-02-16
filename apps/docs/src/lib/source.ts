import { docs } from "@/.source";
import { loader, type InferPageType } from "fumadocs-core/source";

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const docsSource = loader({
  // it assigns a URL to your pages
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});

export type DocsPage = InferPageType<typeof docsSource>;

export function getPageImage(page: DocsPage) {
  const segments = [...page.slugs, "image.webp"];
  return {
    segments,
    url: `/og/docs/${segments.join("/")}`,
  };
}

export function getBlogImage(page: DocsPage) {
  // Page slugs are like ["blog", "posts", "hello-world"]
  // OG route is at /og/blog/posts/[...slug], so strip "blog" and "posts" for the param
  const postSlug = page.slugs.slice(2);
  const segments = [...postSlug, "image.webp"];
  return {
    segments,
    url: `/og/blog/posts/${segments.join("/")}`,
  };
}

/**
 * Returns all blog posts (excluding the blog index page) sorted by publishDate descending.
 */
export function getBlogPosts(): DocsPage[] {
  return docsSource
    .getPages()
    .filter((page) => {
      // Must be a blog post under blog/posts/*, not the blog index or posts index
      return (
        page.slugs[0] === "blog" &&
        page.slugs[1] === "posts" &&
        page.slugs.length > 2 &&
        page.data.publishDate != null
      );
    })
    .sort((a, b) => {
      const dateA = a.data.publishDate?.getTime() ?? 0;
      const dateB = b.data.publishDate?.getTime() ?? 0;
      return dateB - dateA; // newest first
    });
}
