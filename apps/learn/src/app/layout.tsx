import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { ProgressProvider } from "@/components/progress-provider";
import "./globals.css";

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
