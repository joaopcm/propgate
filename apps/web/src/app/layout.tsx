import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { jsonLd, SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  alternates: { canonical: "./" },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: SITE_DESCRIPTION,
    locale: "en_US",
    siteName: "propgate",
    title: "propgate",
    type: "website",
  },
  title: { default: "propgate", template: "%s — propgate" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={cn("dark h-full antialiased", sans.variable, mono.variable)}
      lang="en"
    >
      <body className="flex min-h-full flex-col font-sans">
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is generated from our own constants
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }}
          type="application/ld+json"
        />
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
