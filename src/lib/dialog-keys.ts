// ダイアログのキー操作の判定(純粋関数)。
// DOM の KeyboardEvent はここに持ち込まず、判定に要る値だけを受け取る
// (購読は src/components/use-close-on-escape.ts が受け持つ)。

/**
 * 日本語入力などの変換中のキー入力で送られる keyCode。
 * isComposing は変換の始まり・終わりの境目で false になることがあり、
 * Safari は変換中のキー入力を keyCode 229 で送ることがあるため、両方で見る
 * (MDN「Element: keydown event」の変換中のイベントを無視する例と同じ判定)
 */
const IME_PROCESS_KEY_CODE = 229;

/** 判定に要るキー入力の値(KeyboardEvent の同名プロパティ) */
export type DialogKeyInput = {
  key: string;
  isComposing: boolean;
  keyCode: number;
  /** ほかの部品がこのキー入力を処理済みか(preventDefault されたか) */
  defaultPrevented: boolean;
};

/**
 * このキー入力でダイアログを閉じてよいかを判定する。
 * Escape で閉じる。ただし次の場合は閉じない:
 * - 変換中の Escape … 変換の取り消しであり、ダイアログを閉じる操作ではない
 *   (スタッフメモやメニュー名の入力中に起きる)
 * - ほかの部品が処理済みの Escape … 例: キーボードでの並べ替え中の Escape は
 *   並べ替えの取り消し(@dnd-kit の KeyboardSensor が preventDefault する)
 */
export function shouldCloseDialogOnKey(input: DialogKeyInput): boolean {
  if (input.key !== "Escape") {
    return false;
  }
  if (input.isComposing || input.keyCode === IME_PROCESS_KEY_CODE) {
    return false;
  }
  return !input.defaultPrevented;
}
