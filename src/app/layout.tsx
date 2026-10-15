// ============================================================================
// Next.js Root Layout Component
//
// The root shell wrapping the entire application:
// - Imports global stylesheet (`globals.css`)
// - Sets up Inter typography font variable
// - Provides Ant Design component theme and tokens via `AntdProvider`
// - Declares global document metadata (page title and description)
// ============================================================================

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AntdProvider from "@/components/providers/AntdProvider";
import { siteConfig } from "@/config/site-config";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  icons: {
    icon: [
      { url: siteConfig.logo, type: "image/png" },
    ],
    shortcut: [siteConfig.logo],
    apple: [siteConfig.logo],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans h-full antialiased`}>
        <AntdProvider>
          {children}
        </AntdProvider>
      </body>
    </html>
  );
}
