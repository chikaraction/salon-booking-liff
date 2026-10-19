"use client";

// 設定画面の「節ごとに編集して保存する」共通部品。
// 配線と見た目だけを持ち、変更の有無の判定は src/lib の純粋関数
// (changedWeeklyHourWeekdays / changedStaffFields など)が担う。
//
// 節ごとに次の挙動を揃えるために置いている:
//   - 変更が無ければ保存ボタンを押せない(送信中の無効化は従来どおり)
//   - 変更があるときだけ「元に戻す」を出し、保存済みの値に戻す
//   - 節の見出しに「未保存の変更」バッジ、変更された行・項目に目印を出す
//
// 色・角丸はデザイントークンのみ(ADR-006)。バッジと目印は primary の
// 対(primary / primary-foreground)で、淡い下地 accent の上でも
// ライト・ダーク両テーマで読める組み合わせにしてある。

import { Loader2, Undo2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const saveButtonClass = "h-11 rounded-xl px-5 text-base";
const subButtonClass = "h-11 rounded-xl px-4 text-base";

/**
 * 変更された行・項目の下地。
 * 色だけに頼らないよう ChangedMark の「変更」ラベルと必ず併せて使う。
 * 行の左右に食い込ませて、入力欄の並びをずらさずに帯を出す。
 */
export const changedRowClass = "-mx-2 rounded-lg bg-accent px-2 py-1";

/** 節の見出しに出す「未保存の変更」バッジ */
export function UnsavedBadge() {
  return (
    <span className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
      未保存の変更
    </span>
  );
}

/** 変更された行・項目に付ける「変更」の目印 */
export function ChangedMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground",
        className,
      )}
    >
      変更
    </span>
  );
}

/** 保存済みの値に戻すボタン(変更があるときだけ出す) */
export function RevertButton({
  disabled,
  onRevert,
}: {
  disabled: boolean;
  onRevert: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onRevert}
      className={subButtonClass}
    >
      <Undo2 aria-hidden="true" className="size-4" />
      元に戻す
    </Button>
  );
}

/**
 * 節の保存ボタンまわり(保存する / 元に戻す / 保存しました / エラー)。
 * 変更が無いあいだ保存ボタンは押せない(isDirty = false)。
 */
export function SectionFooter({
  isPending,
  isDirty,
  saved,
  message,
  onSave,
  onRevert,
}: {
  isPending: boolean;
  /** 保存済みの値から変更があるか(純粋関数の判定結果) */
  isDirty: boolean;
  /** 直前の保存が成功したか(「保存しました」の表示) */
  saved: boolean;
  message: string | null;
  onSave: () => void;
  onRevert: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        onClick={onSave}
        disabled={isPending || !isDirty}
        className={saveButtonClass}
      >
        {isPending && (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        )}
        保存する
      </Button>
      {isDirty && <RevertButton disabled={isPending} onRevert={onRevert} />}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          保存しました
        </p>
      )}
      {message !== null && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * 節の編集状態。保存済みの値(props)を基準に、編集中の値と
 * 「元に戻す」の戻し先を持つ。
 *
 * 保存後に基準値が新しくなる経路は2つあり、両方を扱う:
 *
 * 1. **props の入れ替わり**(本筋)。Server Action は成功すると
 *    revalidatePath するので、サーバーコンポーネントが描き直されて
 *    新しい props が降ってくる。このときクライアントの state は保たれるため、
 *    基準値を props に追従させないと保存しても「未保存の変更」が消えない。
 *    追従のとき、編集していなければ編集中の値も新しい props に合わせ
 *    (他の節の保存でデータが変わったとき古い値を見せ続けない)、
 *    編集中なら編集を捨てない(別の節を保存したときに書きかけを消さない)。
 *
 * 2. **markSaved()**。revalidate が届かない経路やネットワークの都合で
 *    props の更新が遅れても、保存に成功した時点で「変更なし」に戻すための口。
 *    基準値を今の編集中の値まで進める(保存したのはこの値そのもの)。
 *
 * @param saved 保存済みの値(props)
 * @param isSame 2つの値が「保存結果として同じ」かの判定(src/lib の純粋関数)
 */
export function useSavedDraft<T>(
  saved: T,
  isSame: (a: T, b: T) => boolean,
): {
  /** 基準(保存済み)の値。変更箇所の判定に使う */
  base: T;
  /** 編集中の値 */
  draft: T;
  setDraft: (next: T | ((current: T) => T)) => void;
  /** 編集を捨てて保存済みの値に戻す */
  revert: () => void;
  /** 保存に成功した(基準値を編集中の値まで進める) */
  markSaved: () => void;
} {
  const [state, setState] = useState({
    /** 直前に受け取った props(入れ替わりの検知に使う。値の比較ではない) */
    propsValue: saved,
    base: saved,
    draft: saved,
  });

  let base = state.base;
  let draft = state.draft;
  if (state.propsValue !== saved) {
    // props が入れ替わった(保存後の再描画など)。基準値を差し替える
    base = saved;
    draft = isSame(state.base, state.draft) ? saved : state.draft;
    setState({ propsValue: saved, base, draft });
  }

  return {
    base,
    draft,
    setDraft: (next) =>
      setState((current) => ({
        ...current,
        draft:
          typeof next === "function"
            ? (next as (value: T) => T)(current.draft)
            : next,
      })),
    revert: () => setState((current) => ({ ...current, draft: current.base })),
    markSaved: () =>
      setState((current) => ({ ...current, base: current.draft })),
  };
}
