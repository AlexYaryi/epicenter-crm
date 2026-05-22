import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Epicenter Rental OS",
  description: "CRM and fleet investment operating system for Epicenter car rental.",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png", sizes: "512x512" }
    ],
    shortcut: "/favicon.png",
    apple: "/apple-touch-icon.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
