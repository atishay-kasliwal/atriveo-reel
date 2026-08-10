import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Atriveo Reel",
  description: "Paste two videos, pick two moments, get a vertical comparison reel.",
  applicationName: "Atriveo Reel",
  // The app sits behind a private password; there is nothing to index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  width: "device-width",
  initialScale: 1,
  // The editor uses fixed vertical layouts; zooming breaks the 9:16 preview.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
