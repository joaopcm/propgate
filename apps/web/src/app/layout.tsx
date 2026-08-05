import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  description: "Domain onboarding and lifecycle infrastructure",
  metadataBase: new URL("https://propgate.dev"),
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
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
