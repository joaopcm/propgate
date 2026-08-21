import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { ProgressProvider } from "@/components/progress-provider";
import "./globals.css";

/**
 * Three faces, and each one is doing a job the others cannot.
 *
 * `display` is Instrument Serif, for unit numbers and titles. High contrast,
 * editorial, and unmistakably not a reference page — which is the point, since
 * a reader arriving from docs.propgate.dev should know within a second that
 * this is a different kind of document.
 *
 * `body` is Newsreader, because a unit is two thousand words read start to
 * finish and a serif is the better tool for that.
 *
 * `mono` is JetBrains Mono, identical to the docs. It is the continuity
 * anchor: a record, a command and a diagnosis code have to look the same in
 * both places or the reader learns two visual languages for one contract.
 */
const display = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display",
  weight: "400",
});

const body = Newsreader({ subsets: ["latin"], variable: "--font-body" });

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  description:
    "A course on what actually goes wrong when a customer adds your DNS records, and how to build something that can tell them.",
  metadataBase: new URL("https://learn.propgate.dev"),
  title: {
    default: "Verifying domains — a propgate course",
    template: "%s — propgate course",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={`dark h-full antialiased ${display.variable} ${body.variable} ${mono.variable}`}
      lang="en"
    >
      <body className="bg-background font-body text-foreground">
        <ProgressProvider>{children}</ProgressProvider>
      </body>
    </html>
  );
}
