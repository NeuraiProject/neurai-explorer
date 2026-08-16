import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SyncStatus } from "@/components/SyncStatus";
import HeaderNav from "@/components/HeaderNav";
import MobileNav from "@/components/MobileNav";
import HomeLabel from "@/components/HomeLabel";
import FooterSocials from "@/components/FooterSocials";
import { ScrollToTop } from "@/components/ScrollToTop";
import Link from "next/link";
import config from "../config.json";

export const metadata: Metadata = {
  metadataBase: new URL('https://explorer.neurai.org'),
  title: {
    default: config.site.title,
    template: `%s | ${config.site.title}`,
  },
  description: config.site.description,
  openGraph: {
    title: config.site.title,
    description: config.site.description,
    url: 'https://explorer.neurai.org',
    siteName: config.site.title,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Neurai Explorer Preview',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: config.site.title,
    description: config.site.description,
    images: ['/og-image.png'],
    creator: '@neuraiproject',
  },
  icons: {
    icon: config.site.logoPath || '/neurai-logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`font-sans antialiased`}>
        <Providers>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            disableTransitionOnChange
          >
            <div className="flex flex-col min-h-screen bg-background text-foreground">
              <header className="sticky top-0 z-50 w-full border-b border-border bg-card">
                <div className="container max-w-7xl mx-auto flex h-16 items-center justify-between gap-4 px-4 lg:px-6">
                  <Link href="/" className="flex items-center gap-3 shrink-0 group">
                    <img
                      src={config.site.logoPath || "/neurai-logo.png"}
                      alt={config.site.logoAlt || `${config.site.coinName} Logo`}
                      className="w-10 h-10 rounded-full"
                    />
                    <HomeLabel />
                  </Link>
                  <HeaderNav className="hidden lg:flex" />
                  <nav className="flex items-center gap-2 sm:gap-3">
                    <SyncStatus />
                    <div className="hidden lg:block">
                      <ThemeToggle />
                    </div>
                    <MobileNav />
                  </nav>
                </div>
              </header>
              <main className="flex-1 container max-w-7xl mx-auto py-6 lg:py-8 px-4 lg:px-6">{children}</main>
              <footer className="border-t border-border bg-card">
                <div className="container max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 px-4 lg:px-6 py-6 text-sm text-muted-foreground">
                  <p>
                    © {new Date().getFullYear()} Neurai ·{" "}
                    <a href="https://neurai.org" target="_blank" rel="noreferrer" className="text-link hover:underline">
                      neurai.org
                    </a>
                  </p>
                  <FooterSocials />
                </div>
              </footer>
            </div>
            <ScrollToTop />
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
