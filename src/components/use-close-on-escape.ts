"use client";

// Escape でダイアログを閉じる共通フック。
// このプロジェクトのダイアログは radix を使わない自前の作りなので、Escape の
// 購読をダイアログごとに書く代わりにこれを呼ぶ。閉じてよいかの判定は
// 純粋関数 shouldCloseDialogOnKey(src/lib/dialog-keys.ts)に任せる。

import { useEffect } from "react";

import { shouldCloseDialogOnKey } from "@/lib/dialog-keys";

/**
 * Escape で onClose を呼ぶ。onClose には背景クリック・「閉じる(×)」と
 * 同じ関数を渡す(閉じ方で挙動が変わらないように)。
 *
 * document ではなく window で購読する: キーボードイベントは document の後に
 * window へ伝わるので、document で Escape を処理する部品(@dnd-kit の
 * KeyboardSensor は並べ替え開始後に document へ keydown を付け、Escape で
 * preventDefault する)の後に判定でき、defaultPrevented を見て譲れる。
 * document で購読すると、ダイアログを開いた時点で付けたこちらが先に呼ばれ、
 * 並べ替えの取り消しのつもりの Escape でダイアログごと閉じてしまう。
 *
 * @param enabled false の間は Escape で閉じない(処理中で背景タップも
 *   無効にしているときなど)。省略時は true
 */
export function useCloseOnEscape(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        shouldCloseDialogOnKey({
          key: event.key,
          isComposing: event.isComposing,
          // keyCode は非推奨だが、Safari の変換中の判定(229)に要る
          keyCode: event.keyCode,
          defaultPrevented: event.defaultPrevented,
        })
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, enabled]);
}
