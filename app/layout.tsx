import type { Metadata, Viewport } from "next";
import "./globals.css";
import { themeBootScript } from "./lib/theme-script";

export const metadata: Metadata = {
  title: "smiles.ink — SMILES canvas",
  description:
    "A fast, private, fully local canvas for rendering beautiful chemical structures from SMILES.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          id="smiles-ink-theme"
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
