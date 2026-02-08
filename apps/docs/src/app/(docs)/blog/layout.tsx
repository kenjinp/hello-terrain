import { baseOptions } from "@/lib/layout.shared";
import { docsSource } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

export default function Layout({ children }: LayoutProps<"/blog">) {
  const layoutProps = { ...baseOptions() };
  return (
    <DocsLayout tree={docsSource.pageTree} {...layoutProps}>
      {children}
    </DocsLayout>
  );
}
