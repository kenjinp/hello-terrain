import "@/app/global.css";
import { Footer } from "@/components/Footer/Footer";
import { LevaPanel } from "@/components/LevaPanel/LevaPanel";
import DefaultSearchDialog from "@/components/Search/Search";
import { RootProvider } from "fumadocs-ui/provider";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  icons: {
    icon: "/assets/logo.svg",
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          search={{
            SearchDialog: DefaultSearchDialog,
          }}
        >
          <LevaPanel />
          {children}
          <Footer />
        </RootProvider>
      </body>
    </html>
  );
}
