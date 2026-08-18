"use client";

// 予約カレンダーの表示(配線に徹する)。日/週の配置計算は
// src/lib/admin-calendar.ts が済ませており、ここは受け取った結果を描画し、
// ナビゲーションをURL遷移(?view=&date=)に変換するだけ。
// 色はスタッフの並び順から staff-colors.ts が決める(ADR-007)。

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  dayNavLabel,
  moveDay,
  weekNavLabel,
  weekStartOf,
  weekdayLabel,
  type AdminStaff,
  type DayTimeline,
  type ReservationListItem,
  type WeekView,
} from "@/lib/admin-calendar";
import { isCalendarDate } from "@/lib/availability";
import { cn } from "@/lib/utils";

import { ReservationDetailDialog } from "./reservation-detail-dialog";
import { staffColor } from "./staff-colors";
import {
  HourLines,
  TimeGutter,
  TimelineBlocks,
  timelineHeight,
} from "./timeline-column";

type Props = {
  staff: AdminStaff[];
  date: string; // 表示中のJST暦日 "YYYY-MM-DD"
  todayDate: string; // サーバーが渡す今日(JST)。ハイドレーション不一致回避
  view: "day" | "week";
  // 日表示の入力(週表示のときは未使用)
  timeline: DayTimeline;
  listItems: ReservationListItem[];
  // 週表示の入力(日表示のときは未使用)
  weekView: WeekView;
};

export function CalendarView({
  staff,
  date,
  todayDate,
  view,
  timeline,
  listItems,
  weekView,
}: Props) {
  const router = useRouter();

  // 選択中の予約ID(カレンダーの予約カードをクリックすると詳細ダイアログを開く)
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const go = (nextView: "day" | "week", nextDate: string) => {
    router.push(`/admin?view=${nextView}&date=${nextDate}`);
  };

  const isToday =
    view === "day"
      ? date === todayDate
      : weekStartOf(date) === weekStartOf(todayDate);

  const centerLabel =
    view === "day" ? dayNavLabel(date) : weekNavLabel(weekStartOf(date));

  const handlePrev = () => go(view, moveDay(date, view === "day" ? -1 : -7));
  const handleNext = () => go(view, moveDay(date, view === "day" ? 1 : 7));

  return (
    <div className="flex h-dvh flex-col md:h-screen">
      {/* ヘッダー(前後ナビ + 日付ピッカー + 今日 + 日/週トグル) */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 md:px-6">
        {/* 可視の見出しは日付ピッカーが兼ねる(日付の二重表示を避ける)。
            ページ見出しとしては読み上げ用に残す */}
        <h1 className="sr-only">{centerLabel}</h1>

        {/* ‹ › が日付ピッカーを左右から挟む(移動対象が一目で分かる) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrev}
            aria-label={view === "day" ? "前の日" : "前の週"}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>

          {/* 日付ジャンプ(‹ › は1日/1週ずつなので、遠い日付へは直接指定する) */}
          <input
            type="date"
            value={date}
            aria-label="日付を指定して移動"
            onChange={(event) => {
              const next = event.target.value;
              // 入力途中・消去時は空文字や不正な日付になる。その間は遷移しない
              if (!isCalendarDate(next)) return;
              go(view, next);
            }}
            className="h-9 w-[9.5rem] rounded-lg border border-border bg-card px-2 text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />

          {/* 日表示: ネイティブの日付入力は曜日を出さない。定休日の判断に要るので添える。
              週表示: 曜日ではなく ‹ › が動かす単位(週)を示す */}
          <span className="text-sm text-muted-foreground">
            {view === "day" ? `(${weekdayLabel(date)})` : "週"}
          </span>

          <button
            type="button"
            onClick={handleNext}
            aria-label={view === "day" ? "次の日" : "次の週"}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => go(view, todayDate)}
          aria-current={isToday ? "date" : undefined}
          className={cn(
            "h-8 rounded-lg px-3 text-sm font-medium transition-colors",
            isToday
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          今日
        </button>

        {/* 週表示のスタッフ色分け凡例 */}
        {view === "week" && (
          <ul className="hidden items-center gap-3 md:flex">
            {staff.map((member, index) => (
              <li
                key={member.id}
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className={cn("size-3 rounded-sm", staffColor(index).legend)}
                />
                {member.name}
              </li>
            ))}
          </ul>
        )}

        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border p-0.5">
          {(["day", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => go(option, date)}
              aria-pressed={view === option}
              className={cn(
                "h-7 rounded-md px-3 text-sm font-medium transition-colors",
                view === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {option === "day" ? "日" : "週"}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {view === "day" ? (
          <DayView
            staff={staff}
            timeline={timeline}
            listItems={listItems}
            onSelect={setSelectedId}
          />
        ) : (
          <WeekGrid
            staff={staff}
            weekView={weekView}
            onSelect={setSelectedId}
          />
        )}
      </div>

      {selectedId !== null && (
        <ReservationDetailDialog
          key={selectedId}
          reservationId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 日表示
// ---------------------------------------------------------------------------

function DayView({
  staff,
  timeline,
  listItems,
  onSelect,
}: {
  staff: AdminStaff[];
  timeline: DayTimeline;
  listItems: ReservationListItem[];
  onSelect: (id: string) => void;
}) {
  // スマホ幅のみ「タイムライン / リスト」を切り替える(モックH・I)
  const [mobileMode, setMobileMode] = useState<"timeline" | "list">("timeline");

  // 予約のない休業日だけ「定休日です。」で終える。定休日でも予約があれば
  // (ticks が立つ)タイムラインを描画し、上部に定休日バッジを添える。
  if (timeline.isClosed && timeline.ticks.length === 0) {
    return <p className="p-6 text-base text-muted-foreground">定休日です。</p>;
  }

  return (
    <>
      {timeline.isClosed && <ClosedDayBanner />}

      {/* PC/タブレット: 全スタッフ列を並べたタイムライン(モックB) */}
      <div className="hidden md:block">
        <DayTimelineGrid
          staff={staff}
          timeline={timeline}
          onSelect={onSelect}
        />
      </div>

      {/* スマホ: タイムライン(1人)/ リスト の切替(モックH・I) */}
      <div className="md:hidden">
        <div className="flex gap-0.5 border-b border-border p-3">
          {(["timeline", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMobileMode(mode)}
              aria-pressed={mobileMode === mode}
              className={cn(
                "h-9 flex-1 rounded-lg text-sm font-medium transition-colors",
                mobileMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {mode === "timeline" ? "タイムライン" : "リスト"}
            </button>
          ))}
        </div>
        {mobileMode === "timeline" ? (
          <MobileTimeline timeline={timeline} onSelect={onSelect} />
        ) : (
          <ReservationList listItems={listItems} onSelect={onSelect} />
        )}
      </div>
    </>
  );
}

/**
 * 定休日でも予約があるときに、タイムライン上部へ添える定休日バッジ。
 * 定休日への新規登録はブロックされるが、過去・別経路の予約は表示・確認できる。
 */
function ClosedDayBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 md:px-6">
      <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
        定休日
      </span>
      <span className="text-sm text-muted-foreground">
        定休日ですが予約があります(新規の登録はできません)
      </span>
    </div>
  );
}

/** PC/タブレットの日表示: 左に時間目盛り、右にスタッフ列 */
function DayTimelineGrid({
  staff,
  timeline,
  onSelect,
}: {
  staff: AdminStaff[];
  timeline: DayTimeline;
  onSelect: (id: string) => void;
}) {
  const height = timelineHeight(timeline.tickMarks);
  const gridColumns = `repeat(${timeline.columns.length}, minmax(0, 1fr))`;
  const colorByStaffId = new Map(
    staff.map((member, index) => [member.id, staffColor(index)]),
  );

  return (
    <div className="min-w-max md:min-w-0">
      {/* 列見出し */}
      <div className="flex border-b border-border">
        <div className="w-14 shrink-0" />
        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: gridColumns }}
        >
          {timeline.columns.map((column) => (
            <div
              key={column.staffId}
              className="border-l border-border px-3 py-2 text-center text-sm font-bold"
            >
              {column.heading}
            </div>
          ))}
        </div>
      </div>

      {/* 本体 */}
      <div className="flex" style={{ height }}>
        <div className="relative w-14 shrink-0">
          <TimeGutter tickMarks={timeline.tickMarks} />
        </div>
        <div className="relative flex-1">
          <HourLines tickMarks={timeline.tickMarks} />
          <div
            className="grid h-full"
            style={{ gridTemplateColumns: gridColumns }}
          >
            {timeline.columns.map((column) => (
              <div
                key={column.staffId}
                className="relative border-l border-border"
              >
                <TimelineBlocks
                  blocks={column.blocks}
                  bookingCardClass={
                    colorByStaffId.get(column.staffId)?.card ?? ""
                  }
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** スマホの日表示タイムライン: スタッフを1人選んで1列表示(モックH) */
function MobileTimeline({
  timeline,
  onSelect,
}: {
  timeline: DayTimeline;
  onSelect: (id: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const height = timelineHeight(timeline.tickMarks);
  const column = timeline.columns[selectedIndex];

  if (timeline.columns.length === 0 || column === undefined) {
    return (
      <p className="p-6 text-base text-muted-foreground">
        表示できるスタッフがいません。
      </p>
    );
  }

  return (
    <div>
      {/* スタッフ切替セグメント */}
      <div className="flex gap-2 p-3">
        {timeline.columns.map((col, index) => (
          <button
            key={col.staffId}
            type="button"
            onClick={() => setSelectedIndex(index)}
            aria-pressed={selectedIndex === index}
            className={cn(
              "h-11 flex-1 rounded-xl text-base font-bold transition-colors",
              selectedIndex === index
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {col.heading}
          </button>
        ))}
      </div>

      <div className="flex px-3 pb-6" style={{ height }}>
        <div className="relative w-12 shrink-0">
          <TimeGutter tickMarks={timeline.tickMarks} />
        </div>
        <div className="relative flex-1 border-l border-border">
          <HourLines tickMarks={timeline.tickMarks} />
          <TimelineBlocks
            blocks={column.blocks}
            bookingCardClass={staffColor(selectedIndex).card}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}

/** スマホの日表示リスト: その日の全スタッフの予約を時刻順に並べる(モックI) */
function ReservationList({
  listItems,
  onSelect,
}: {
  listItems: ReservationListItem[];
  onSelect: (id: string) => void;
}) {
  if (listItems.length === 0) {
    return (
      <p className="p-6 text-base text-muted-foreground">
        この日の予約はありません。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3 p-4">
      {listItems.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="w-14 shrink-0 text-base font-bold text-primary">
              {item.timeLabel}
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold">{item.customerLabel}</p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {item.menuStaffLabel}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 週表示
// ---------------------------------------------------------------------------

function WeekGrid({
  staff,
  weekView,
  onSelect,
}: {
  staff: AdminStaff[];
  weekView: WeekView;
  onSelect: (id: string) => void;
}) {
  const colorIndexByStaffId = new Map(
    staff.map((member, index) => [member.id, index]),
  );

  // 週内に営業日が1日もない(時間軸なし)場合のフォールバック
  if (weekView.ticks.length === 0) {
    return (
      <p className="p-6 text-base text-muted-foreground">
        この週に営業日はありません。
      </p>
    );
  }

  const height = timelineHeight(weekView.tickMarks);

  return (
    // 横スクロールだけを担う領域。overflow-x-auto は既定で overflow-y を
    // auto に格上げしてしまい(CSS仕様)、横スクロールバー出現時に不要な
    // 縦スクロールバーを生む。縦は親(overflow-auto)に委ね、ここでは固定する。
    <div className="overflow-x-auto overflow-y-hidden">
      <div className="min-w-[48rem]">
        {/* 曜日見出し */}
        <div className="flex border-b border-border">
          <div className="w-12 shrink-0" />
          <div className="grid flex-1 grid-cols-7">
            {weekView.days.map((day) => (
              <div
                key={day.date}
                className={cn(
                  "border-l border-border px-2 py-2 text-center text-sm font-bold",
                  // 定休日は本体セルと同じ下地を敷き、列全体が休みだと一目で分かるようにする
                  day.isClosed && "bg-secondary text-muted-foreground",
                )}
              >
                {day.dayNumber} {day.weekdayLabel}
              </div>
            ))}
          </div>
        </div>

        {/* 本体 */}
        <div className="flex" style={{ height }}>
          <div className="relative w-12 shrink-0">
            <TimeGutter tickMarks={weekView.tickMarks} />
          </div>
          <div className="relative flex-1">
            <HourLines tickMarks={weekView.tickMarks} />
            <div className="grid h-full grid-cols-7">
              {weekView.days.map((day) => (
                <div
                  key={day.date}
                  className={cn(
                    "relative border-l border-border",
                    // 定休日: 斜線ハッチングは実機で見分けがつきにくかったため、
                    // べた塗りの背景色に変更。--secondary はページ背景(--background)
                    // に対してライト 0.93/0.965、ダーク 0.269/0.145 と明度差があり、
                    // 不透明度を下げずに敷くことで一目で休みだと分かる。色はトークンのみ
                    day.isClosed && "bg-secondary",
                  )}
                >
                  {/* 背景色だけでは意味が伝わらないのでラベルは残す。予約があれば
                      その上に重ねて描画する(定休日への新規登録はブロックするが、
                      過去・別経路の予約は隠さない) */}
                  {day.isClosed && (
                    <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs font-bold text-secondary-foreground">
                      定休日
                    </p>
                  )}
                  {day.items.map((item) => {
                    const colorIndex =
                      colorIndexByStaffId.get(item.staffId) ?? 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item.id)}
                        className={cn(
                          // ring は定休日の下地(bg-secondary)と同色のカード
                          // (staff-colors の3人目)でも輪郭が消えないようにする
                          "absolute inset-x-0.5 overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left ring-1 ring-border transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          staffColor(colorIndex).card,
                        )}
                        style={{
                          top: `${item.topPercent}%`,
                          height: `${item.heightPercent}%`,
                        }}
                      >
                        <p className="truncate text-xs font-bold">
                          {item.titleLabel}
                        </p>
                        {item.menuLabel !== null && (
                          <p className="truncate text-xs text-muted-foreground">
                            {item.menuLabel}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
