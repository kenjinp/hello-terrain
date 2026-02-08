import { getBlogPosts } from "@/lib/source";
import type { DocsPage } from "@/lib/source";
import { BlogPostRow } from "./BlogPostRow";

/**
 * Groups posts by year from their publishDate.
 */
function groupByYear(posts: DocsPage[]): [string, DocsPage[]][] {
  const groups = new Map<string, DocsPage[]>();
  for (const post of posts) {
    const year = post.data.publishDate!.getFullYear().toString();
    const list = groups.get(year) ?? [];
    list.push(post);
    groups.set(year, list);
  }
  // Already sorted newest-first from getBlogPosts, so years come in descending order
  return Array.from(groups.entries());
}

export function BlogPostList() {
  const posts = getBlogPosts();

  if (posts.length === 0) {
    return <p className="text-fd-muted-foreground">No posts yet. Check back soon!</p>;
  }

  const years = groupByYear(posts);

  return (
    <div className="flex flex-col gap-10">
      {years.map(([year, yearPosts]) => (
        <section key={year}>
          <h2 className="text-lg font-semibold text-fd-foreground mb-1">{year}</h2>
          <div className="flex flex-col">
            {yearPosts.map((post) => (
              <BlogPostRow key={post.url} page={post} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
