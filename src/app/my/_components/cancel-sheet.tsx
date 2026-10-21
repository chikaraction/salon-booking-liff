// キャンセル確認のボトムシート(モック07準拠)。表示と操作の受け渡しのみ。

import type { MyReservationCard } from "@/app/my/actions";
import { Button } from "@/components/ui/button";

type Props = {
  reservation: MyReservationCard;
  /** キャンセル処理中(ボタン・背景タップを無効化する) */
  busy: boolean;
  /** シート内に表示するエラー(auth / server_error。閉じずに再試行できる) */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export function CancelSheet({
  reservation,
  busy,
  error,
  onConfirm,
  onClose,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-sheet-title"
    >
      {/* 背景(タップで閉じる) */}
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 bg-black/40 animate-in fade-in"
        disabled={busy}
        onClick={onClose}
      />
      {/* シート本体(画面下から表示) */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-card px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 animate-in slide-in-from-bottom duration-200">
        <h2 id="cancel-sheet-title" className="text-center text-xl font-bold">
          予約をキャンセルしますか？
        </h2>
        <div className="mt-3 text-center">
          <p className="text-base text-muted-foreground">
            {reservation.dateTimeLabel}
          </p>
          <p className="mt-1 text-base text-muted-foreground">
            {reservation.menuStaffLabel}
          </p>
        </div>

        {error !== null && (
          <p className="mt-4 rounded-xl bg-destructive/10 p-4 text-base text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3">
          <Button
            variant="destructive"
            className="h-12 w-full rounded-xl text-base"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "キャンセルしています…" : "キャンセルする"}
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full rounded-xl text-base"
            disabled={busy}
            onClick={onClose}
          >
            戻る
          </Button>
        </div>
      </div>
    </div>
  );
}
