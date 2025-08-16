import { baseOptions } from "@/lib/layout.shared";
import { GithubInfo } from "fumadocs-ui/components/github-info";
import { HomeLayout } from "fumadocs-ui/layouts/home";

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <HomeLayout
      {...baseOptions()}
      links={[
        {
          on: "nav",
          text: "Showcase",
          url: "/showcase",
          secondary: false,
        },
        {
          on: "nav",
          text: "Sponsors",
          url: "/sponsors",
          secondary: false,
        },
        {
          on: "nav",
          text: "Docs",
          url: "/docs",
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
      ]}
    >
      {children}
    </HomeLayout>
  );
}
