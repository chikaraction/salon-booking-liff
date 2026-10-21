"use client";

// LIFF のエントリーページ(LIFF のエンドポイントURLはサイトのルート /)。
// liff.init() を呼んで、liff.state があれば SDK の2次リダイレクト(/my など)に任せ、
// 無ければ /booking へ移る。判定は src/lib/liff-entry.ts、初期化は src/liff/client.ts。

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { decideLiffEntry } from "@/lib/liff-entry";
import { initLiff } from "@/liff/client";

export default function LiffEntryPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const stubMode = process.env.NEXT_PUBLIC_LIFF_STUB === "1";
    // liff.state で SDK が遷移するときは initLiff() が解決しないので、
    // ここから先は SDK が遷移しなかったときだけ動く(二重遷移にならない)
    void initLiff().then((ok) => {
      if (cancelled) return;
      const decision = decideLiffEntry(window.location.search, {
        stubMode,
        initFailed: !ok,
      });
      if (decision.kind === "redirect") {
        router.replace(decision.path);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <p className="text-base text-muted-foreground" role="status">
        読み込み中…
      </p>
    </div>
  );
}
