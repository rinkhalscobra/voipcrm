import type { Metadata, Viewport } from "next";
import { QueryProvider } from "@/components/query-provider";
import { brandLogo } from "@/lib/branding";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-controls";
import { themeBootstrap } from "@/lib/theme";
import "./globals.css";
const platformName = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Voixel";
const title = `${platformName} · Telecom workspace`;
const description = `Manage telecom operations, customer companies, calls, and billing with ${platformName}.`;
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://127.0.0.1:3000"),
  applicationName: platformName,
  title: { default: title, template: `%s · ${platformName}` },
  description,
  authors: [{ name: platformName }],
  creator: platformName,
  publisher: platformName,
  icons: {
    icon: { url: brandLogo.src, type: "image/png" },
    shortcut: brandLogo.src,
    apple: { url: brandLogo.src, type: "image/png" },
  },
  openGraph: {
    type: "website",
    siteName: platformName,
    title,
    description,
    images: [
      {
        url: brandLogo.src,
        width: brandLogo.width,
        height: brandLogo.height,
        alt: `${platformName} logo`,
      },
    ],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: [{ url: brandLogo.src, alt: `${platformName} logo` }],
  },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e16" },
  ],
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          id="voixel-theme-init"
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
        />
        <ThemeProvider>
          <QueryProvider>{children}</QueryProvider>
          <div className="public-theme-control">
            <ThemeToggle />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
