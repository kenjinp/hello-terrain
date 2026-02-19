import { fonts, persistentImages } from "@/components/OpenGraph/Image";
import { docsSource, getBlogImage } from "@/lib/source";
import type { PersistentImage } from "@takumi-rs/core";
import ImageResponse from "@takumi-rs/image-response";
import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const revalidate = 86400;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/og/blog/posts/[...slug]">,
) {
  const { slug } = await params;
  // slug = ["hello-world", "image.webp"] → page slugs = ["blog", "posts", "hello-world"]
  const pageSlugs = ["blog", "posts", ...slug.slice(0, -1)];
  const page = docsSource.getPage(pageSlugs);
  if (!page) notFound();

  const { title, description, image, publishDate } = page.data;

  // Load the blog post image from public/ so the renderer can access it
  const allImages: PersistentImage[] = [...persistentImages];
  if (image) {
    const imagePath = join(process.cwd(), "public", image);
    if (existsSync(imagePath)) {
      allImages.push({ src: "blog-image", data: readFileSync(imagePath) });
    }
  }

  return new ImageResponse(
    <div
      style={{
        width: "1200px",
        height: "630px",
        position: "relative",
        backgroundColor: "#ffffff",
        overflow: "hidden",
        display: "flex",
      }}
    >
      {/* OG background peeks through as a border/frame */}
      <img
        src="background"
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "1200px",
          height: "630px",
          objectFit: "cover",
        }}
      />

      {/* Blog image fills most of the card with padding to reveal the background frame */}
      {image && (
        <div
          style={{
            position: "absolute",
            top: "24px",
            left: "24px",
            right: "24px",
            bottom: "24px",
            borderRadius: "16px",
            overflow: "hidden",
            display: "flex",
          }}
        >
          <img
            src="blog-image"
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          {/* Dark gradient overlay for text legibility */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.15) 100%)",
            }}
          />
        </div>
      )}

      {/* Text content pinned to bottom-left over the image */}
      <div
        style={{
          position: "absolute",
          bottom: "56px",
          left: "56px",
          right: "56px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {/* Date */}
        {publishDate && (
          <div
            style={{
              fontFamily: "Lato",
              fontSize: "20px",
              fontWeight: 400,
              color: "rgba(255,255,255,0.7)",
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            }}
          >
            {publishDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        )}

        {/* Title */}
        <div
          style={{
            fontFamily: "Lisu Bosa",
            fontSize: "64px",
            fontWeight: 700,
            lineHeight: 1.1,
            color: "#ffffff",
            letterSpacing: "-0.04em",
            textShadow: "0 2px 8px rgba(0,0,0,0.7)",
          }}
        >
          {title}
        </div>

        {/* Description */}
        {description && (
          <div
            style={{
              fontFamily: "Lato",
              fontSize: "28px",
              fontWeight: 400,
              lineHeight: 1.4,
              color: "rgba(255,255,255,0.85)",
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            }}
          >
            {description}
          </div>
        )}
      </div>

      {/* Hello Terrain logo + text top-left */}
      <div
        style={{
          position: "absolute",
          top: "44px",
          left: "56px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {/* Speech bubble + mountain logo */}
        <div
          style={{
            width: "44px",
            height: "44px",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="44"
            height="44"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <path
              d="M4 4c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H8.83L5.59 20.17A1 1 0 0 1 4 19.41V4z"
              fill="#6dd1ed"
              opacity="0.9"
            />
          </svg>
          <img
            src="mountain"
            alt=""
            style={{
              position: "absolute",
              top: "4px",
              width: "22px",
              height: "22px",
              objectFit: "contain",
            }}
          />
        </div>
        <div
          style={{
            fontFamily: "Lisu Bosa",
            fontSize: "24px",
            fontWeight: 600,
            fontStyle: "italic",
            color: "rgba(255,255,255,0.8)",
            textShadow: "0 1px 4px rgba(0,0,0,0.5)",
          }}
        >
          Hello Terrain
        </div>
      </div>
    </div>,
    {
      persistentImages: allImages,
      fonts,
      width: 1200,
      height: 630,
      format: "webp",
    },
  );
}

export function generateStaticParams() {
  return docsSource
    .getPages()
    .filter(
      (p) =>
        p.slugs[0] === "blog" &&
        p.slugs[1] === "posts" &&
        p.slugs.length > 2 &&
        p.data.publishDate != null,
    )
    .map((page) => ({
      slug: getBlogImage(page).segments,
    }));
}
