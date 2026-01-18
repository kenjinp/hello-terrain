import { docsSource } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";
import { PageFooter } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsPage } from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export default async function Page(props: PageProps<"/examples/[[...slug]]">) {
  const params = await props.params;
  const page = docsSource.getPage(["examples", ...(params.slug ?? [])]);
  if (!page) notFound();

  const MDXContent = page.data.body;

  // Example pages don't render DocsTitle/DocsDescription here
  // because the ExampleLayout component handles title display
  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      footer={{ component: <PageFooter className="footer-nav-glass" /> }}
    >
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(docsSource, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  // Limit params to the examples subtree and strip the leading "examples" segment
  return docsSource
    .generateParams()
    .filter((p: { slug?: string[] }) => Array.isArray(p.slug) && p.slug[0] === "examples")
    .map((p: { slug: string[] }) => ({ slug: p.slug.slice(1) }));
}

export async function generateMetadata(
  props: PageProps<"/examples/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = docsSource.getPage(["examples", ...(params.slug ?? [])]);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
