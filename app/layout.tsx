import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PSX Research Desk",
  description:
    "Company evidence and expert commentary for personal PSX research",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
