import { docs } from "@/.source";
import { loader, type InferPageType } from "fumadocs-core/source";

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const docsSource = loader({
  // it assigns a URL to your pages
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});

export function getPageImage(page: InferPageType<typeof docsSource>) {
  const segments = [...page.slugs, "image.webp"];
  return {
    segments,
    url: `/og/docs/${segments.join("/")}`,
  };
}
