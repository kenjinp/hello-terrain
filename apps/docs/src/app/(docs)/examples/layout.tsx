import Footer from "@/components/Footer";
import { baseOptions } from "@/lib/layout.shared";
import { docsSource } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

export default function Layout({ children }: LayoutProps<"/examples">) {
  const layoutProps = { ...baseOptions() };
  return (
    <DocsLayout
      tree={docsSource.pageTree}
      {...layoutProps}
      nav={{
        transparentMode: "top",
        component: null,
      }}
    >
      {children}
      <Footer />
    </DocsLayout>
  );
}
