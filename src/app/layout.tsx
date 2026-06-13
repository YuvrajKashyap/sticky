import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sticky",
  description: "A premium Google Tasks-style sticky task app.",
  applicationName: "Sticky",
  metadataBase: new URL("https://sticky.yuvrajkashyap.com"),
  manifest: "/manifest.webmanifest",
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: "Sticky",
    description: "Premium sticky tasks for fast capture, lists, subtasks, due dates, and recurrence.",
    url: "https://sticky.yuvrajkashyap.com",
    siteName: "Sticky",
    type: "website",
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
  maximumScale: 1,
  themeColor: "#ffce3a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
