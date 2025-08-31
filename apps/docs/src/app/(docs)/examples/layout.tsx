import { Metrics, MetricsProvider } from "@/components/Metrics/Metrics";
import { baseOptions } from "@/lib/layout.shared";
import { docsSource } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

export default function Layout({ children }: LayoutProps<"/examples">) {
  const layoutProps = { ...baseOptions() };
  return (
    <MetricsProvider>
      <DocsLayout
        tree={docsSource.pageTree}
        {...layoutProps}
        sidebar={{
          banner: <Metrics />,
        }}
      >
        {children}
      </DocsLayout>
    </MetricsProvider>
  );
}
