import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scout: find creators by niche, reach and engagement",
  description: "Search YouTube, Instagram and TikTok for creators in any niche, then filter by followers, average views, likes, engagement and country.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
