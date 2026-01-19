import { OGImageResponse } from "@/components/OpenGraph/Image";
import { docsSource, getPageImage } from "@/lib/source";
import { notFound } from "next/navigation";

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<"/og/docs/[...slug]">) {
  const { slug } = await params;
  const page = docsSource.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return OGImageResponse({ title: page.data.title, description: page.data.description });
}

export function generateStaticParams() {
  return docsSource.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}
