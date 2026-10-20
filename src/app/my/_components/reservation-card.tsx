// マイ予約一覧の予約カード。表示のみ(可否判定・文言整形は親と src/lib/ に委ねる)。

import Link from "next/link";

import type { MyReservationCard } from "@/app/my/actions";
import { Button } from "@/components/ui/button";

type Props = {
  reservation: MyReservationCard;
  /** 右上の残り日数ラベル(例: 本日 / あと3日 / 8月2日) */
  remainingLabel: string;
  /** 客自身で変更・キャンセルできるか(締切前か)。判定は canModifyReservation */
  canModify: boolean;
  onCancelClick: () => void;
};

export function ReservationCard({
  reservation,
  remainingLabel,
  canModify,
  onCancelClick,
}: Props) {
  return (
    // 白いカードはページ背景(#f7f6f3)と明度が近いので、モックどおり淡い枠を付ける
    <article className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-accent px-3 py-1 text-sm font-bold text-primary-strong">
          確定
        </span>
        <span className="text-sm text-muted-foreground">{remainingLabel}</span>
      </div>
      <p className="mt-3 text-lg font-bold">{reservation.dateTimeLabel}</p>
      <p className="mt-1 text-base text-muted-foreground">
        {reservation.menuStaffLabel}
      </p>
      <p className="mt-1 text-base text-muted-foreground">
        {reservation.priceDurationLabel}
      </p>

      <div className="mt-4 flex gap-3">
        {canModify ? (
          <Button
            asChild
            variant="outline"
            className="h-12 flex-1 rounded-xl text-base"
          >
            <Link
              href={`/booking?change=${encodeURIComponent(reservation.id)}`}
            >
              変更
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled
            className="h-12 flex-1 rounded-xl text-base"
          >
            変更
          </Button>
        )}
        <Button
          variant="outline-destructive"
          disabled={!canModify}
          className="h-12 flex-1 rounded-xl text-base"
          onClick={onCancelClick}
        >
          キャンセル
        </Button>
      </div>

      {!canModify && (
        <p className="mt-3 rounded-xl bg-accent p-3 text-sm text-primary-strong">
          変更・キャンセルはお店に直接ご連絡ください
        </p>
      )}
    </article>
  );
}
