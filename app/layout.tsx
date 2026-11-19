import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Remedium Sales Dashboard",
  description: "Sales by SKU and customer, synced from QuickBooks Online.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
