import type { Metadata, Viewport } from "next";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/orbitron/500.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "@fontsource/share-tech-mono/400.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";
import { StickyPlatformProvider } from "@/components/providers/StickyPlatformProvider";

export const metadata: Metadata = {
  title: "Sticky",
  description: "A private, connected task command center for fast capture and focused follow-through.",
  applicationName: "Sticky",
  verification: {
    google: "RYwr0jHqEfxAnRJ2MFMMVIR3dpWYvGKRYaS_FgCZQgs",
  },
  metadataBase: new URL("https://sticky.yuvrajkashyap.com"),
  manifest: "/manifest.webmanifest",
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: "Sticky",
    description: "Fast capture, focused planning, recurring work, reminders, and a connected task API.",
    url: "https://sticky.yuvrajkashyap.com",
    siteName: "Sticky",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sticky",
    description: "Fast capture, focused planning, recurring work, reminders, and a connected task API.",
  },
  icons: {
    icon: [
      { url: "/brand/sticky-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/sticky-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico?v=glass-s", sizes: "any" },
    ],
    shortcut: "/brand/sticky-32.png",
    apple: { url: "/brand/sticky-180.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sticky",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05070f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><StickyPlatformProvider>{children}</StickyPlatformProvider></body>
    </html>
  );
}
