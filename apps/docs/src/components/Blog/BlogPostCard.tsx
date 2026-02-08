import type { DocsPage } from "@/lib/source";
import Link from "next/link";

export function BlogPostCard({ page }: { page: DocsPage }) {
  const { title, description, publishDate, image, authors } = page.data;

  return (
    <Link
      href={page.url}
      className="group flex flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card transition-colors hover:bg-fd-accent/50"
    >
      {image && (
        <div className="relative aspect-[2/1] w-full overflow-hidden bg-fd-muted">
          <img
            src={image}
            alt={typeof title === "string" ? title : ""}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="font-semibold text-fd-foreground leading-snug group-hover:text-fd-primary transition-colors">
          {title}
        </h3>
        {description && (
          <p className="text-sm text-fd-muted-foreground line-clamp-2">{description}</p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-fd-muted-foreground">
          {publishDate && (
            <time dateTime={publishDate.toISOString()}>
              {publishDate.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          )}
          {authors && authors.length > 0 && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span>{authors.join(", ")}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
