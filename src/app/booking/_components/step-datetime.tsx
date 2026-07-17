"use client";

// STEP 3: 日時選択。月カレンダーで日付を選び、その日の開始時刻をボタン一覧で選ぶ。
// 週配列・日付の選択可否・月移動可否の判断は src/lib/calendar.ts の純粋関数に委ねる。

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { AvailabilitySlot } from "@/app/booking/actions";
import type { BookingPolicy } from "@/lib/availability";
import {
  addMonths,
  buildCalendarWeeks,
  calendarDateLabel,
  canMoveToMonth,
  formatJstTime,
  isSelectableDate,
  jstYearMonth,
  yearMonthLabel,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

const WEEKDAY_HEADERS = ["日", "月", "火", "水", "木", "金", "土"];

type Props = {
  businessHours: Array<{ weekday: number; isOpen: boolean }>;
  policy: BookingPolicy;
  /** 選択中メニューの合計所要時間(注記の表示用) */
  durationMinutes: number;
  selectedDate: string | null;
  slots: AvailabilitySlot[] | null;
  slotsLoading: boolean;
  slotsError: string | null;
  selectedStartISO: string | null;
  onSelectDate: (date: string) => void;
  onSelectStart: (startISO: string) => void;
};

export function StepDatetime({
  businessHours,
  policy,
  durationMinutes,
  selectedDate,
  slots,
  slotsLoading,
  slotsError,
  selectedStartISO,
  onSelectDate,
  onSelectStart,
}: Props) {
  const now = new Date();
  // 表示する月。選択済みの日付があればその月から始める
  const [displayMonth, setDisplayMonth] = useState(
    () => selectedDate?.slice(0, 7) ?? jstYearMonth(now),
  );
  const prevMonth = addMonths(displayMonth, -1);
  const nextMonth = addMonths(displayMonth, 1);

  return (
    <div className="flex flex-col gap-5">
      {/* 月カレンダー */}
      <div className="rounded-2xl bg-card p-4">
        <div className="flex items-center justify-between">
          <MonthNavButton
            label="前の月へ"
            disabled={!canMoveToMonth(prevMonth, policy, now)}
            onClick={() => setDisplayMonth(prevMonth)}
          >
            <ChevronLeft className="size-5" />
          </MonthNavButton>
          <p className="text-lg font-bold">{yearMonthLabel(displayMonth)}</p>
          <MonthNavButton
            label="次の月へ"
            disabled={!canMoveToMonth(nextMonth, policy, now)}
            onClick={() => setDisplayMonth(nextMonth)}
          >
            <ChevronRight className="size-5" />
          </MonthNavButton>
        </div>
        <div className="mt-2 grid grid-cols-7 text-center">
          {WEEKDAY_HEADERS.map((label, weekday) => (
            <span
              key={label}
              className={cn(
                "py-1 text-sm",
                weekday === 0 ? "text-primary/80" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          ))}
          {buildCalendarWeeks(displayMonth)
            .flat()
            .map((cell, index) =>
              cell === null ? (
                <span key={`empty-${index}`} />
              ) : (
                <DayCell
                  key={cell.date}
                  day={cell.day}
                  selected={cell.date === selectedDate}
                  selectable={isSelectableDate({
                    date: cell.date,
                    businessHours,
                    policy,
                    now,
                  })}
                  onSelect={() => onSelectDate(cell.date)}
                />
              ),
            )}
        </div>
      </div>

      {/* 選択した日の空き時間 */}
      {selectedDate !== null && (
        <section>
          <h2 className="text-base font-bold">
            {calendarDateLabel(selectedDate)}の空き時間
          </h2>
          {slotsLoading && (
            <p className="mt-3 text-base text-muted-foreground">
              空き状況を確認しています…
            </p>
          )}
          {slotsError !== null && (
            <p className="mt-3 text-base text-destructive">{slotsError}</p>
          )}
          {slots !== null && slots.length === 0 && (
            <p className="mt-3 text-base text-muted-foreground">
              この日にご予約いただける時間はありません
            </p>
          )}
          {slots !== null && slots.length > 0 && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {slots.map((slot) => {
                  const label = formatJstTime(new Date(slot.startISO));
                  if (slot.status === "taken") {
                    // 埋まっている時刻は取り消し線+グレーで選択不可(モック準拠)
                    return (
                      <span
                        key={slot.startISO}
                        aria-disabled="true"
                        className="flex h-12 items-center justify-center rounded-xl border border-border bg-muted text-base text-muted-foreground/70 line-through"
                      >
                        {label}
                      </span>
                    );
                  }
                  const selected = slot.startISO === selectedStartISO;
                  return (
                    <button
                      key={slot.startISO}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectStart(slot.startISO)}
                      className={cn(
                        "flex h-12 items-center justify-center rounded-xl border text-base font-bold transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                ※ 所要{durationMinutes}分の枠が確保できる時間のみ表示
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function MonthNavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-lg text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function DayCell({
  day,
  selected,
  selectable,
  onSelect,
}: {
  day: number;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
}) {
  // 定休日・受付期間外・過去の日付は無効表示(空き有無は日付選択時に判定する)
  return (
    <button
      type="button"
      disabled={!selectable}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "mx-auto flex size-11 items-center justify-center rounded-lg text-base",
        selected && "bg-primary font-bold text-primary-foreground",
        !selected && selectable && "text-foreground",
        !selectable && "text-muted-foreground/40",
      )}
    >
      {day}
    </button>
  );
}
