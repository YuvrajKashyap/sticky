import type { Metadata, Viewport } from "next";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/orbitron/500.css";
import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import "@fontsource/share-tech-mono/400.css";
import "./globals.css";
import { StickyPlatformProvider } from "@/components/providers/StickyPlatformProvider";

export const metadata: Metadata = {
  title: "Sticky",
  description: "A private, connected task command center for fast capture and focused follow-through.",
  applicationName: "Sticky",
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
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
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
