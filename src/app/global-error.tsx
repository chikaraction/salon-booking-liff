"use client";

// ルートレイアウト自体が落ちたときの最後の受け皿。ルートレイアウトの代わりに
// 描かれるので <html>・<body> を自前で出す。globals.css(Tailwind)とフォントは
// 効かないので、見た目は error-screen.tsx に寄せた最小限のインラインスタイルで書く
// (色は globals.css の :root のトークンと同じ値)。文言は客向けの src/app/error.tsx と同じ。
// metadata は export できないので、タイトルは React の <title> で出す。

import { useEffect } from "react";

const colors = {
  background: "oklch(0.973 0.004 91.4)",
  foreground: "oklch(0.28 0.012 35)",
  card: "oklch(1 0 0)",
  destructive: "oklch(0.574 0.148 30.8)",
  destructiveSoftBg: "oklch(0.574 0.148 30.8 / 0.1)",
  input: "oklch(0.864 0.011 89.7)",
  mutedForeground: "oklch(0.52 0.015 45)",
};

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // 開発時の調査用(ブラウザのコンソールに出す)
    console.error(error);
  }, [error]);

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          backgroundColor: colors.background,
          color: colors.foreground,
          fontFamily: "system-ui, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <title>予約画面を開けませんでした</title>
        <main
          style={{
            display: "flex",
            minHeight: "100dvh",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 448,
              boxSizing: "border-box",
              padding: 32,
              borderRadius: 16,
              backgroundColor: colors.card,
              boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
            }}
          >
            <h1
              style={{
                margin: 0,
                textAlign: "center",
                fontSize: 20,
                lineHeight: 1.4,
                fontWeight: 700,
              }}
            >
              {/* 文節の切れ目でだけ折り返す(error-screen.tsx と同じ考え方) */}
              <span style={{ display: "inline-block" }}>予約画面を</span>
              <span style={{ display: "inline-block" }}>開けませんでした</span>
            </h1>
            <p
              role="alert"
              style={{
                margin: "24px 0 0",
                padding: 16,
                borderRadius: 12,
                backgroundColor: colors.destructiveSoftBg,
                color: colors.destructive,
                fontSize: 16,
                lineHeight: 1.5,
              }}
            >
              {
                "時間をおいて、もう一度お試しください。お急ぎの場合は、LINE のトークでお店にご連絡ください。"
              }
            </p>
            <button
              type="button"
              // retry() はサーバーコンポーネントを取り直してから描き直す(Next 16.3〜)
              onClick={() => retry()}
              style={{
                marginTop: 16,
                width: "100%",
                height: 48,
                borderRadius: 12,
                border: `1.5px solid ${colors.input}`,
                backgroundColor: colors.card,
                color: colors.mutedForeground,
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              再読み込み
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
