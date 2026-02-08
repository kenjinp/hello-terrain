import "@/app/global.css";
import { Footer } from "@/components/Footer/Footer";
import { LevaPanel } from "@/components/LevaPanel/LevaPanel";
import DefaultSearchDialog from "@/components/Search/Search";
import { RootProvider } from "fumadocs-ui/provider";
import type { Metadata } from "next";
import { Lato, Lisu_Bosa } from "next/font/google";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  icons: {
    icon: "/assets/logo.svg",
  },
};

const sans = Lato({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-sans",
  weight: ["400", "700"],
});

const serif = Lisu_Bosa({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  weight: ["400", "600"],
});

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <Script
          src="https://plausible.io/js/pa-ba2GUGyQD-ursX_yCMA3E.js"
          strategy="afterInteractive"
        />
        <Script id="plausible-init" strategy="afterInteractive">
          {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}
        </Script>
      </head>
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
