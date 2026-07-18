// 時間軸グリッドの部品(日表示PC・スマホ・週表示で共用する薄い描画層)。
// 配置(top%・height%・ラベル)の計算は src/lib/admin-calendar.ts が済ませている。

import type { PlacedBlock, TickMark } from "@/lib/admin-calendar";
import { cn } from "@/lib/utils";

/** 時間軸の表示高さ。目盛りの数から1時間 ≒ 4rem で概算する */
export function timelineHeight(tickMarks: TickMark[]): string {
  return `${Math.max(tickMarks.length - 1, 1) * 4}rem`;
}

/** 左端の時間目盛りラベル(親要素は relative + timelineHeight であること) */
export function TimeGutter({ tickMarks }: { tickMarks: TickMark[] }) {
  return (
    <>
      {tickMarks.map((mark) => (
        <span
          key={mark.label}
          className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground"
          style={{ top: `${mark.topPercent}%` }}
        >
          {mark.label}
        </span>
      ))}
    </>
  );
}

/** 1時間ごとの横罫線(親要素は relative であること) */
export function HourLines({ tickMarks }: { tickMarks: TickMark[] }) {
  return (
    <>
      {tickMarks.map((mark) => (
        <div
          key={mark.label}
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-border"
          style={{ top: `${mark.topPercent}%` }}
        />
      ))}
    </>
  );
}

/**
 * 配置済みブロック(予約・休憩・予約不可)を1列分描画する。
 * - 予約: 淡色カード+左ボーダー(bookingCardClass でスタッフ色分け)
 * - 休憩: さらに淡いブロック
 * - ブロック(kind=block): 斜線ハッチング+「予約不可」ラベル
 * onSelect が渡され、かつ予約(type="booking"で id あり)のときだけ
 * クリック可能にして予約詳細ダイアログを開く。休憩・ブロックは非クリック。
 */
export function TimelineBlocks({
  blocks,
  bookingCardClass,
  onSelect,
}: {
  blocks: PlacedBlock[];
  bookingCardClass: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <>
      {blocks.map((block, index) => {
        const clickable =
          onSelect !== undefined &&
          block.type === "booking" &&
          block.id !== null;
        const content = (
          <>
            <p
              className={cn(
                "truncate",
                block.type === "booking"
                  ? "text-sm font-bold"
                  : "text-xs font-medium",
              )}
            >
              {block.titleLabel}
            </p>
            {block.menuLabel !== null && (
              <p className="truncate text-xs text-muted-foreground">
                {block.menuLabel}
              </p>
            )}
            {block.priceLabel !== null && (
              <p className="mt-1 truncate text-xs font-bold">
                {block.priceLabel}
              </p>
            )}
          </>
        );
        const className = cn(
          "absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1.5 text-left",
          block.type === "booking" && cn("border-l-4", bookingCardClass),
          block.type === "break" && "bg-muted text-muted-foreground",
          block.type === "block" &&
            "bg-secondary bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--color-border)_6px,var(--color-border)_7px)] text-secondary-foreground",
          clickable &&
            "cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        );
        const style = {
          top: `${block.topPercent}%`,
          height: `${block.heightPercent}%`,
        };

        if (clickable) {
          return (
            <button
              key={block.id}
              type="button"
              className={className}
              style={style}
              onClick={() => onSelect(block.id as string)}
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={block.id ?? `break-${index}`}
            className={className}
            style={style}
          >
            {content}
          </div>
        );
      })}
    </>
  );
}
