import type { Metadata, Viewport } from "next";
import "./globals.css";

const themeScript = `
(() => {
  try {
    const stored = localStorage.getItem("drawchem-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.dataset.theme = theme;
  } catch {}
})();`;

export const metadata: Metadata = {
  title: "Drawchem — SMILES canvas",
  description:
    "A fast, private, fully local canvas for rendering beautiful chemical structures from SMILES.",
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
          id="drawchem-theme"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
