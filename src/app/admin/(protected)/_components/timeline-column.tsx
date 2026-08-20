// 時間軸グリッドの部品(日表示PC・スマホ・週表示で共用する薄い描画層)。
// 配置(top%・height%・ラベル)の計算は src/lib/admin-calendar.ts が済ませている。

import type { ColumnAnchor, PlacedBlock, TickMark } from "@/lib/admin-calendar";
import { cn } from "@/lib/utils";

/**
 * 予約カードから、そのカードが載っている列とグリッド全体の左右Xを測る。
 * カード(absolute)の親 = 列(relative なコンテナ)、その親 = 列グリッド、
 * という構造は日表示(DayTimelineGrid)・週表示(WeekGrid)で共通。
 * 変更ダイアログを空き枠クリックの代行登録と同じ位置に出すために使う
 * (位置の判断は純粋関数 formDialogInitialX。ここは計測だけ)。
 * 親が取れない場合は null を返し、呼び出し側でフォールバック(右寄せ)にする。
 */
export function cardColumnAnchor(
  event: React.MouseEvent<HTMLElement>,
): ColumnAnchor | null {
  const column = event.currentTarget.parentElement;
  if (column === null) return null;
  const columnRect = column.getBoundingClientRect();
  const gridRect = column.parentElement?.getBoundingClientRect() ?? columnRect;
  return {
    columnLeft: columnRect.left,
    columnRight: columnRect.right,
    gridLeft: gridRect.left,
    gridRight: gridRect.right,
  };
}

/** 時間軸の表示高さ。目盛りの数から1時間 ≒ 4rem で概算する */
export function timelineHeight(tickMarks: TickMark[]): string {
  return `${Math.max(tickMarks.length - 1, 1) * 4}rem`;
}

/** 左端の時間目盛りラベル(親要素は relative + timelineHeight であること) */
export function TimeGutter({ tickMarks }: { tickMarks: TickMark[] }) {
  const lastIndex = tickMarks.length - 1;
  return (
    <>
      {tickMarks.map((mark, index) => (
        <span
          key={mark.label}
          className={cn(
            "absolute right-2 text-xs text-muted-foreground",
            // 中央合わせのままだと、先頭(top 0%)は上半分・末尾(top 100%)は
            // 下半分が時間軸コンテナの外へ出る。週表示のラッパーは
            // overflow-y-hidden なので末尾の「18:00」が切れて読めなかった。
            // 端の2つだけ軸の内側へ寄せる(罫線の位置は変えないので、
            // 端以外は従来どおり中央合わせ=罫線とラベルの対応は保たれる)。
            // topPercent の浮動小数誤差に依存しないよう、値ではなく
            // 先頭要素/末尾要素かどうかで判定する
            index === 0
              ? "translate-y-0"
              : index === lastIndex
                ? "-translate-y-full"
                : "-translate-y-1/2",
          )}
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
 * - 予約: スタッフ色の下地+左ボーダー+実線の輪郭(bookingCardClass)
 * - 休憩: bg-muted + 破線の枠(予約カードと違う「枠の形」で区別する)
 * - ブロック(kind=block): 斜線ハッチング+実線の輪郭+「予約不可」ラベル
 * onSelect が渡され、かつ予約(type="booking"で id あり)のときだけ
 * クリック可能にして予約詳細ダイアログを開く。休憩・ブロックは非クリック。
 * フォームダイアログを開いている間は onSelect を渡さない = カードは押せず、
 * 押せる見た目(cursor-pointer・ホバー)も出ない。
 */
export function TimelineBlocks({
  blocks,
  bookingCardClass,
  onSelect,
}: {
  blocks: PlacedBlock[];
  bookingCardClass: string;
  /** 第2引数はカードが載っている列の座標(変更ダイアログの初期位置に使う) */
  onSelect?: (id: string, anchor: ColumnAnchor | null) => void;
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
            {/* menuLabel が入るのは予約カード(スタッフ色の下地)のみ。
                muted-foreground では下地とのコントラストが約3.9:1 で薄いため、
                foreground を弱めた濃さにする(約5.3:1。1行目の約10.3:1 より弱く、
                ライト・ダークとも本文コントラスト 4.5:1 を満たす) */}
            {block.menuLabel !== null && (
              <p className="truncate text-xs text-foreground/75">
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
          // ブロック同士が上下で接したときに切れ目が見えるよう、共通で細い輪郭を
          // 内側に引く(ring-inset。外側に出すと隣のブロックに重なる)。
          // 休憩だけは破線の枠にして「予約ではない」ことを形でも示す
          "absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1.5 text-left",
          // button はブラウザ既定で中身を上下中央・横中央に寄せるため、同じ
          // クラスでも div と縦位置が食い違っていた(押せる/押せないで動く)。
          // flex-col + justify-start で上詰め、items-stretch で子を横幅いっぱいに
          // (truncate を効かせる)して、button でも div でも同じ見た目にする。
          // モック(02-予約カレンダー)のとおり常に上詰めが正
          "flex flex-col items-stretch justify-start",
          block.type !== "break" && "ring-1 ring-inset ring-border",
          block.type === "booking" && cn("border-l-4", bookingCardClass),
          block.type === "break" &&
            "border border-dashed border-muted-foreground/50 bg-muted text-muted-foreground",
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
              // 列の空き枠クリック(代行登録ダイアログ)へ伝播させない。
              // 予約カードの上では従来どおり予約詳細ダイアログを開く
              onClick={(event) => {
                event.stopPropagation();
                onSelect(block.id as string, cardColumnAnchor(event));
              }}
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
