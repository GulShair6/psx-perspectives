import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PSX Perspectives",
  description:
    "Understand YouTube and expert perspectives on Pakistan Stock Exchange stocks, with dated transcript evidence",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
