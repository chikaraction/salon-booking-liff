"use client";

// エラー境界(src/app/error.tsx・src/app/admin/error.tsx)が出す共通の画面。
// 見出しと本文は呼び出し側が決める(客向け・店側向けで文言が違う)。
// 見出しは文節の配列で受け取り、文節の切れ目でだけ折り返す(スマホ幅で
// 「…ませんで/した」のように最後の数文字だけ次の行に落ちないように)。
// 店舗固有の値(店名・電話番号)は出さない(ADR-007。DBに繋がらないときに出るので取得もしない)。
// error.message は画面に出さない(本番では隠されるうえ、内部の情報なので)。

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export function ErrorScreen({
  error,
  retry,
  titleParts,
  message,
}: {
  error: unknown;
  retry: () => void;
  titleParts: string[];
  message: string;
}) {
  useEffect(() => {
    // 開発時の調査用(ブラウザのコンソールに出す)
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-sm sm:p-10">
        <h1 className="text-center text-xl font-bold sm:text-2xl">
          {titleParts.map((part) => (
            <span key={part} className="inline-block">
              {part}
            </span>
          ))}
        </h1>
        <p
          role="alert"
          className="mt-6 rounded-xl bg-destructive/10 p-4 text-base text-destructive"
        >
          {message}
        </p>
        <Button
          variant="outline"
          className="mt-4 h-12 w-full rounded-xl text-base"
          // retry() はサーバーコンポーネントを取り直してから描き直す(Next 16.3〜)
          onClick={() => retry()}
        >
          再読み込み
        </Button>
      </div>
    </main>
  );
}
