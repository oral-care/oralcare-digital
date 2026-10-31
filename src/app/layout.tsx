import type { Metadata } from "next";
import { headers } from "next/headers";

import { interSans } from "./fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: "Oral Care Digital",
  robots: { index: false, follow: false },
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
