import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Systems",
  description: "A local-first learning system for serious computer science courses."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
