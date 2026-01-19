import { OGImageResponse } from "@/components/OpenGraph/Image";
import { homePages, type HomePageKey } from "@/lib/home-pages";
import { notFound } from "next/navigation";

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<"/og/[slug]">) {
  const { slug } = await params;
  // Expect slug like "home.webp" or "about.webp"
  const pageKey = slug.replace(".webp", "") as HomePageKey;
  const page = homePages[pageKey];

  if (!page) notFound();

  return OGImageResponse({ title: page.title, description: page.description });
}

export function generateStaticParams() {
  return Object.keys(homePages).map((key) => ({
    slug: `${key}.webp`,
  }));
}
