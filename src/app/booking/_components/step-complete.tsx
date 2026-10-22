// 予約完了。チェックマークと予約内容カードを表示する。表示のみ。
// 見出しは新規予約・予約変更(M3)で親が出し分ける。
// 見出しの下の「確認のメッセージをLINEにお送りしました」(モック05)は、予約確認の定型文を
// LINEに送れたとき(lineMessageSent)だけ出す(M5。失敗・LINE外・スタブでは出さない)。

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
  /** 予約確認の定型文をLINEに送れたか。true のときだけ見出しの下に補足文を出す */
  lineMessageSent: boolean;
};

export function StepComplete({
  heading,
  startISO,
  menusLabel,
  staffName,
  totalPrice,
  totalDurationMinutes,
  lineMessageSent,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-6 pt-10">
      <span className="flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-10" strokeWidth={3} aria-hidden="true" />
      </span>
      {/* 補足文はモックどおり見出しのすぐ下に寄せる(外側の gap-6 を空けない) */}
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">{heading}</h1>
        {lineMessageSent && (
          <p className="text-base text-muted-foreground">
            確認のメッセージをLINEにお送りしました
          </p>
        )}
      </div>
      {/* 白いカードはページ背景(#f7f6f3)と明度が近いので、モックどおり淡い枠を付ける */}
      <div className="w-full rounded-2xl border border-border bg-card p-4">
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
