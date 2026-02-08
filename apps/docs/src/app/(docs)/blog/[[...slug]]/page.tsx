import { docsSource, getBlogImage } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";
import { PageFooter } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

function assertBlogFrontmatter(page: {
  data: { publishDate?: Date; image?: string };
  file: { path: string };
}) {
  const missing: string[] = [];
  if (!page.data.publishDate) missing.push("publishDate");
  if (!page.data.image) missing.push("image");
  if (missing.length > 0) {
    throw new Error(
      `Blog post "${page.file.path}" is missing required frontmatter: ${missing.join(", ")}`,
    );
  }
}

export default async function Page(props: PageProps<"/blog/[[...slug]]">) {
  const params = await props.params;
  const page = docsSource.getPage(["blog", ...(params.slug ?? [])]);
  if (!page) notFound();

  // Blog index page doesn't need publishDate/image
  const isBlogIndex = !params.slug || params.slug.length === 0;
  if (!isBlogIndex) {
    assertBlogFrontmatter(page);
  }

  const MDXContent = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      footer={{ component: <PageFooter className="footer-nav-glass" /> }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      {!isBlogIndex && page.data.publishDate && (
        <time
          dateTime={page.data.publishDate.toISOString()}
          className="text-fd-muted-foreground text-sm -mt-2 mb-4 block"
        >
          {page.data.publishDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
      )}
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            a: createRelativeLink(docsSource, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  const params = docsSource
    .generateParams()
    .filter((p: { slug?: string[] }) => Array.isArray(p.slug) && p.slug[0] === "blog")
    .map((p: { slug: string[] }) => ({ slug: p.slug.slice(1) }));

  return [{ slug: [] as string[] }, ...params];
}

export async function generateMetadata(props: PageProps<"/blog/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = docsSource.getPage(["blog", ...(params.slug ?? [])]);
  if (!page) notFound();

  const isBlogPost = params.slug && params.slug.length > 0;
  const ogImage = isBlogPost ? getBlogImage(page).url : undefined;

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: ogImage,
    },
  };
}
