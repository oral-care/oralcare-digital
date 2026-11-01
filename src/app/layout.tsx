import type { Metadata } from "next";
import { headers } from "next/headers";

import { interSans } from "./fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: "Oral Care Digital",
  robots: { index: false, follow: false },
  // The light tile in light browser chrome, the dark one in dark, in 32 px for
  // the tab and 48 px for search results, as on oralcare.se. No media-less
  // favicon.ico: Chrome takes the first icon that fits, so a .ico listed first
  // would always win over these.
  icons: {
    icon: [
      {
        url: "/favicons/oc-favicon-light-32.png",
        type: "image/png",
        sizes: "32x32",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicons/oc-favicon-light-48.png",
        type: "image/png",
        sizes: "48x48",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicons/oc-favicon-dark-32.png",
        type: "image/png",
        sizes: "32x32",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/favicons/oc-favicon-dark-48.png",
        type: "image/png",
        sizes: "48x48",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request makes every page dynamic, so Next.js puts the CSP nonce
  // from src/proxy.ts on its scripts.
  await headers();
  return (
    <html lang="en" className={interSans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
