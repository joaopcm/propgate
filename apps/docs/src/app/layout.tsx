import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  alternates: { canonical: "./" },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: SITE_DESCRIPTION,
    images: [
      {
        alt: "propgate docs: DNS diagnosis and API reference",
        height: 630,
        url: "/opengraph-image",
        width: 1200,
      },
    ],
    siteName: SITE_NAME,
    title: SITE_NAME,
    type: "website",
    url: SITE_URL,
  },
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={`dark h-full antialiased ${sans.variable} ${mono.variable}`}
      lang="en"
    >
      <body className="bg-background font-sans text-foreground">
        <JsonLd />
        {children}
      </body>
    </html>
  );
}
