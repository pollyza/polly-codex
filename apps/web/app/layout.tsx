import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polly",
  description: "Turn pages into host-style spoken briefings."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
