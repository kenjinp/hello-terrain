import { ContourBackground } from "@/components/ContourBackground/ContourBackground";
import { baseOptions, sharedLinkItems } from "@/lib/layout.shared";
import { GithubInfo } from "fumadocs-ui/components/github-info";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Book } from "lucide-react";

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <>
      <ContourBackground />
      <HomeLayout
        {...baseOptions()}
        links={[
          {
            on: "nav",
            text: "Docs",
            url: "/docs",
            secondary: false,
          },
          // {
          //   on: "nav",
          //   text: "Showcase",
          //   url: "/showcase",
          //   secondary: false,
          // },
          // {
          //   on: "nav",
          //   text: "Sponsors",
          //   url: "/sponsors",
          //   secondary: false,
          // },
          {
            on: "nav",
            text: "Blog",
            url: "/blog",
            secondary: false,
          },
          {
            on: "nav",
            text: "About",
            url: "/about",
            secondary: false,
          },
          {
            on: "nav",
            type: "custom",
            // url: "https://github.com/kenjinp/hello-terrain",
            children: <GithubInfo owner="kenjinp" repo="hello-terrain" />,
            secondary: true,
          },
          {
            type: "menu",
            on: "menu",
            text: "Documentation",
            items: [
              {
                text: "Getting Started",
                url: "/docs",
                icon: <Book />,
              },
            ],
          },

          ...sharedLinkItems,
        ]}
      >
        {children}
      </HomeLayout>
    </>
  );
}
