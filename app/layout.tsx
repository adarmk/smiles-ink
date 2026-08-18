import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drawchem — SMILES canvas",
  description:
    "A fast, private, fully local canvas for rendering beautiful chemical structures from SMILES.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
