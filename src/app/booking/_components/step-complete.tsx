// 予約完了。チェックマークと予約内容カードを表示する。表示のみ。
// 見出しは新規予約・予約変更(M3)で親が出し分ける。
// 「確認のメッセージをLINEにお送りしました」の文言はM5(応答メッセージ実装)まで出さない。

import { Check } from "lucide-react";

import { formatJstDateTimeLabel, formatYen } from "@/lib/booking";

type Props = {
  /** 見出し(例: ご予約が完了しました / 予約を変更しました) */
  heading: string;
  startISO: string;
  menusLabel: string;
  staffName: string;
  totalPrice: number;
  totalDurationMinutes: number;
};

export function StepComplete({
  heading,
  startISO,
  menusLabel,
  staffName,
  totalPrice,
  totalDurationMinutes,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-6 pt-10">
      <span className="flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-10" strokeWidth={3} aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-bold">{heading}</h1>
      <div className="w-full rounded-2xl bg-card p-4">
        <p className="text-lg font-bold">
          {formatJstDateTimeLabel(new Date(startISO))}
        </p>
        <p className="mt-1 text-base text-muted-foreground">
          {menusLabel} ／ {staffName}
        </p>
        <p className="mt-1 text-base text-muted-foreground">
          {formatYen(totalPrice)} ・ 約{totalDurationMinutes}分
        </p>
      </div>
      <p className="w-full rounded-xl bg-accent p-4 text-base text-primary-strong">
        予約内容は「マイ予約」でいつでも確認できます。変更・キャンセルもそちらから行えます。
      </p>
    </div>
  );
}
