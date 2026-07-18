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
  type AdminStaff,
  type DayTimeline,
  type ReservationListItem,
  type WeekView,
} from "@/lib/admin-calendar";
import { cn } from "@/lib/utils";

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
      {/* ヘッダー(前後ナビ + ラベル + 今日 + 日/週トグル) */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 md:px-6">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrev}
            aria-label={view === "day" ? "前の日" : "前の週"}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label={view === "day" ? "次の日" : "次の週"}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>

        <h1 className="text-lg font-bold md:text-xl">{centerLabel}</h1>

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
          <DayView staff={staff} timeline={timeline} listItems={listItems} />
        ) : (
          <WeekGrid staff={staff} weekView={weekView} />
        )}
      </div>
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
}: {
  staff: AdminStaff[];
  timeline: DayTimeline;
  listItems: ReservationListItem[];
}) {
  // スマホ幅のみ「タイムライン / リスト」を切り替える(モックH・I)
  const [mobileMode, setMobileMode] = useState<"timeline" | "list">("timeline");

  if (timeline.isClosed) {
    return <p className="p-6 text-base text-muted-foreground">定休日です。</p>;
  }

  return (
    <>
      {/* PC/タブレット: 全スタッフ列を並べたタイムライン(モックB) */}
      <div className="hidden md:block">
        <DayTimelineGrid staff={staff} timeline={timeline} />
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
          <MobileTimeline timeline={timeline} />
        ) : (
          <ReservationList listItems={listItems} />
        )}
      </div>
    </>
  );
}

/** PC/タブレットの日表示: 左に時間目盛り、右にスタッフ列 */
function DayTimelineGrid({
  staff,
  timeline,
}: {
  staff: AdminStaff[];
  timeline: DayTimeline;
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
function MobileTimeline({ timeline }: { timeline: DayTimeline }) {
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
          />
        </div>
      </div>
    </div>
  );
}

/** スマホの日表示リスト: その日の全スタッフの予約を時刻順に並べる(モックI) */
function ReservationList({ listItems }: { listItems: ReservationListItem[] }) {
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
        <li
          key={item.id}
          className="flex items-start gap-4 rounded-xl border border-border bg-card p-4"
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
}: {
  staff: AdminStaff[];
  weekView: WeekView;
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
    <div className="overflow-x-auto">
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
                  day.isClosed && "text-muted-foreground",
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
                    day.isClosed &&
                      "bg-[repeating-linear-gradient(45deg,transparent,transparent_8px,var(--color-muted)_8px,var(--color-muted)_9px)]",
                  )}
                >
                  {day.isClosed ? (
                    <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-muted-foreground">
                      定休日
                    </p>
                  ) : (
                    day.items.map((item) => {
                      const colorIndex =
                        colorIndexByStaffId.get(item.staffId) ?? 0;
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "absolute inset-x-0.5 overflow-hidden rounded-md border-l-4 px-1.5 py-1",
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
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
