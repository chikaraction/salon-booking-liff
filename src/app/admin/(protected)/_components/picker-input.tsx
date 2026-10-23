// 日付・時刻の入力欄に、ピッカーのアイコンを右端に添える部品(描画に徹する)。
// iOS(WebKit)・Android(モバイルの Chromium)は日付・時刻入力にアイコンを
// 描かないので、押せると分かるよう自前で描く。PC の Chromium のアイコン
// (::-webkit-calendar-picker-indicator)は透明にして同じ位置に重ねるので、
// 押すとピッカーが開くのは従来どおり。Firefox は独自のボタンを出すので
// 自前のほうを隠す。Firefox は独自のアイコンを内容領域の右端に描くので、
// 自前のアイコン用に取った右の余白を Firefox だけ通常に戻す(戻さないと
// アイコンが文字に寄って数字に重なる)。入力欄が無効のときはアイコンも薄くする。
// 左右の余白はアイコンの位置と組なので部品が持つ(呼び出し側は px- を渡さない)。

import { CalendarDays, Clock } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Tailwind は arbitrary variant をソース中の完全なクラス文字列からしか
// 生成しないので、right-2 / right-3 の版をそれぞれ省略せずに書く
const compactIndicatorClass =
  "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-2 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:my-auto [&::-webkit-calendar-picker-indicator]:size-4 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0";
const defaultIndicatorClass =
  "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-3 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:my-auto [&::-webkit-calendar-picker-indicator]:size-4 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0";

type Props = Omit<ComponentProps<"input">, "type"> & {
  type: "date" | "time";
  /** 包む span に足すクラス(flex の伸縮など) */
  wrapperClassName?: string;
  /** 余白の小さい入力欄(カレンダーのツールバー: pl-2 pr-8)。既定は設定画面の px-3 に合わせる */
  compact?: boolean;
};

export function PickerInput({
  type,
  className,
  wrapperClassName,
  compact = false,
  ...props
}: Props) {
  const Icon = type === "date" ? CalendarDays : Clock;
  return (
    <span className={cn("relative flex", wrapperClassName)}>
      <input
        type={type}
        {...props}
        className={cn(
          "peer relative",
          compact
            ? "pr-8 pl-2 supports-[-moz-orient:inherit]:pr-2"
            : "pr-9 pl-3 supports-[-moz-orient:inherit]:pr-3",
          compact ? compactIndicatorClass : defaultIndicatorClass,
          className,
        )}
      />
      {/* ネイティブのアイコン(入力のボーダーの内側から right-2 / right-3)と
          重ねるため、span(= 入力の外形)からはボーダー1px を足した位置に置く */}
      <Icon
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 my-auto size-4 text-muted-foreground peer-disabled:opacity-50 supports-[-moz-orient:inherit]:hidden",
          compact ? "right-[9px]" : "right-[13px]",
        )}
      />
    </span>
  );
}
