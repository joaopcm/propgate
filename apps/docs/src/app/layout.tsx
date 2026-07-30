import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  description: "DNS diagnosis taxonomy and API reference",
  metadataBase: new URL("https://docs.propgate.dev"),
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
      <body className="flex min-h-full flex-col font-sans">
        <main className="mx-auto w-full max-w-3xl px-6 py-16">{children}</main>
      </body>
    </html>
  );
}
