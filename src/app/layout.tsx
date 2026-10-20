import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import localFont from "next/font/local";

import { getDisplaySettings } from "@/server/display-settings";

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

// 表示設定で選べるもう1つのフォント(ADR-006の選択肢)。ビルド時に取得して
// 自己ホストされる。subsets に japanese は無く、日本語は unicode-range 分割で
// 配信されるので preload しない。weight 省略で可変フォント
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  preload: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "予約システム",
  description: "美容室の来店予約システム",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // テーマカラーとフォントは data-theme / data-font で globals.css 側が切り替える。
  // 両フォントの変数はどちらが選ばれていても付けておく(表示設定のプレビュー用)
  const display = await getDisplaySettings();

  return (
    <html
      lang="ja"
      data-theme={display.themePreset}
      data-font={display.fontFamily}
      className={`${lineSeedJP.variable} ${notoSansJP.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
