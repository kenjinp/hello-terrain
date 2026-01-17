import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Logo } from "@/components/Logo/Logo";

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Logo size="sm" />
          Hello Terrain
        </>
      ),
    },
    // githubUrl: "https://github.com/kenjinp/hello-terrain",
    // see https://fumadocs.dev/docs/ui/navigation/links
    links: [],
  };
}
