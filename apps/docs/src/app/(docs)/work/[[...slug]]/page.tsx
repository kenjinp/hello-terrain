import { docsSource, getPageImage } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";
import { PageFooter } from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export default async function Page(props: PageProps<"/work/[[...slug]]">) {
  const params = await props.params;
  const page = docsSource.getPage(["work", ...(params.slug ?? [])]);
  if (!page) notFound();

  const MDXContent = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      footer={{ component: <PageFooter className="footer-nav-glass" /> }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
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
  // Limit params to the work subtree and strip the leading "work" segment
  const params = docsSource
    .generateParams()
    .filter((p: { slug?: string[] }) => Array.isArray(p.slug) && p.slug[0] === "work")
    .map((p: { slug: string[] }) => ({ slug: p.slug.slice(1) }));

  // `[[...slug]]` requires an explicit empty slug for `/work` when `output: "export"`.
  return [{ slug: [] as string[] }, ...params];
}

export async function generateMetadata(props: PageProps<"/work/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = docsSource.getPage(["work", ...(params.slug ?? [])]);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  };
}
