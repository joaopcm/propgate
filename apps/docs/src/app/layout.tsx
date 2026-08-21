import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  alternates: { canonical: "./" },
  description:
    "propgate docs: API reference, CLI, SDK, authentication, webhooks, diagnosis taxonomy, and RFC conformance for domain verification.",
  metadataBase: new URL("https://docs.propgate.dev"),
  openGraph: {
    description:
      "propgate docs: API reference, CLI, SDK, authentication, webhooks, and the diagnosis taxonomy.",
    siteName: "propgate docs",
    title: "propgate docs",
    type: "website",
    url: "https://docs.propgate.dev",
  },
  title: { default: "propgate docs", template: "%s — propgate docs" },
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
        {children}
      </body>
    </html>
  );
}
