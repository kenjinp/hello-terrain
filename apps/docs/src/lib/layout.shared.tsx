import { Logo } from "@/components/Logo/Logo";
import type { BaseLayoutProps, LinkItemType } from "fumadocs-ui/layouts/shared";
import { Github, Info, Rss } from "lucide-react";

export const sharedLinkItems: LinkItemType[] = [
  {
    on: "menu",
    text: "Blog",
    url: "/blog",
    active: "url",
    icon: <Rss />,
    secondary: false,
  },
  // {
  //   on: "menu",
  //   text: "Showcase",
  //   url: "/showcase",
  //   icon: <Award />,
  //   active: "url",
  // },
  // {
  //   on: "menu",
  //   text: "Sponsors",
  //   url: "/sponsors",
  //   icon: <Heart />,
  // },
  {
    on: "menu",
    text: "About",
    url: "/about",
    active: "url",
    icon: <Info />,
    secondary: false,
  },
  {
    on: "menu",
    type: "icon",
    url: "https://github.com/kenjinp/hello-terrain",
    label: "github",
    text: "Github",
    icon: <Github />,
    external: true,
  },
];

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
          <span className="ht-logo">Hello Terrain</span>
        </>
      ),
    },
    // githubUrl: "https://github.com/kenjinp/hello-terrain",
    // see https://fumadocs.dev/docs/ui/navigation/links
    links: [...sharedLinkItems],
  };
}
