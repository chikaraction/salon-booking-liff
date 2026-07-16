import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// ADR-006の選択肢のうち LINE Seed JP を採用(公式配布のWOFF2、OFLライセンス)
const lineSeedJP = localFont({
  src: [
    {
      path: "../fonts/LINESeedJP_OTF_Rg.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/LINESeedJP_OTF_Bd.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-line-seed-jp",
});

export const metadata: Metadata = {
  title: "予約システム",
  description: "美容室の来店予約システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${lineSeedJP.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
