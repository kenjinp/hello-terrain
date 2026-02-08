import type { DocsPage } from "@/lib/source";
import Link from "next/link";

/**
 * Compact inline blog post row for the timeline-style listing.
 * Shows a small thumbnail, title, and a monospace date.
 */
export function BlogPostRow({ page }: { page: DocsPage }) {
  const { title, publishDate, image } = page.data;

  return (
    <Link
      href={page.url}
      className="group flex items-center gap-4 py-4 border-t border-fd-border transition-colors hover:bg-fd-accent/30 -mx-3 px-3 rounded-md"
    >
      {/* Small thumbnail */}
      {image && (
        <div className="w-12 h-12 rounded-md overflow-hidden bg-fd-muted">
          <img
            style={{ margin: 0 }}
            src={image}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110 my-0"
          />
        </div>
      )}

      {/* Title */}
      <span className="flex-1 font-medium text-fd-foreground/80 group-hover:text-fd-primary transition-colors truncate">
        {title}
      </span>

      {/* Date in monospace */}
      {publishDate && (
        <time
          dateTime={publishDate.toISOString()}
          className="text-sm font-mono uppercase tracking-wider text-fd-muted-foreground"
        >
          {publishDate.toLocaleDateString("en-US", {
            month: "short",
            day: "2-digit",
          })}
        </time>
      )}
    </Link>
  );
}
