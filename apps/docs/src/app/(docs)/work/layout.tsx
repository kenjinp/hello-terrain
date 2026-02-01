import { baseOptions, sharedLinkItems } from "@/lib/layout.shared";
import { docsSource } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

export default function Layout({ children }: LayoutProps<"/work">) {
  const baseOptionsProps = baseOptions();
  const layoutProps = { ...baseOptionsProps, links: [...sharedLinkItems] };
  return (
    <DocsLayout tree={docsSource.pageTree} {...layoutProps}>
      {children}
    </DocsLayout>
  );
}
