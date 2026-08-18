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
  timeFromTimelineRatio,
  weekItemTooltip,
  weekNavLabel,
  weekStartOf,
  weekdayLabel,
  type AdminStaff,
  type DayTimeline,
  type ReservationListItem,
  type TimelineAxis,
  type WeekView,
} from "@/lib/admin-calendar";
import { isCalendarDate } from "@/lib/availability";
import { cn } from "@/lib/utils";
import type { ActiveMenu } from "@/server/admin-data";

import {
  ProxyRegistrationDialog,
  type ProxyRegistrationTarget,
} from "./proxy-registration-dialog";
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
  /** 空き枠クリック時の時刻の刻み(salon_settings 由来。ADR-007) */
  slotIntervalMinutes: number;
  /** 代行登録ダイアログのメニュー選択に渡す有効メニュー */
  menus: ActiveMenu[];
};

export function CalendarView({
  staff,
  date,
  todayDate,
  view,
  timeline,
  listItems,
  weekView,
  slotIntervalMinutes,
  menus,
}: Props) {
  const router = useRouter();

  // 選択中の予約ID(カレンダーの予約カードをクリックすると詳細ダイアログを開く)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 空き枠クリックで開く代行登録ダイアログの対象(スタッフ・日付・時刻)
  const [createTarget, setCreateTarget] =
    useState<ProxyRegistrationTarget | null>(null);

  /**
   * カレンダーの列で押された位置から代行登録を開く(日表示・週表示で共用)。
   * 縦比率→時刻の変換は純粋関数(timeFromTimelineRatio)に任せる。
   * 列とグリッド全体の左右Xも一緒に持たせ、ダイアログを押した列以外の領域の
   * 中央に出す(dialogInitialX)。
   * - 日表示: 列=スタッフなので staffId が決まる
   * - 週表示: 列=日付で全スタッフが同じ列に並ぶため staffId は決まらない。
   *   日付・時刻だけを初期値にしてスタッフ未選択で開き、ダイアログ内の
   *   スタッフ選択で確定させる(選んだ時点で空き時間一覧・空き判定が出る)
   * 定休日・過去の時間でもここでは開く(登録可否はフォームとサーバーの
   * 既存ガードが「定休日は登録できません」「過去の時間は登録できません」で示す)。
   * 既にダイアログが開いているときは無視する: 非モーダルで背後のカレンダーを
   * 操作できるため、入力途中のクリックでフォームを作り直すと入力が消える。
   * 時刻の変更はフォームの時間欄・空き時間一覧で行う。
   */
  const openCreateAt = (params: {
    /** 週表示は列=日付でスタッフが定まらないため省略する */
    staffId?: string;
    /** クリックされた列の日付(日表示は表示中の日、週表示は列の日付) */
    date: string;
    point: ColumnClickPoint;
    axis: TimelineAxis;
  }) => {
    if (createTarget !== null) return;
    const { point } = params;
    setCreateTarget({
      staffId: params.staffId,
      date: params.date,
      time: timeFromTimelineRatio({
        ratio: point.ratio,
        ...params.axis,
        intervalMinutes: slotIntervalMinutes,
      }),
      columnLeft: point.columnLeft,
      columnRight: point.columnRight,
      gridLeft: point.gridLeft,
      gridRight: point.gridRight,
    });
  };

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
            onCreateAt={(staffId, point, axis) =>
              openCreateAt({ staffId, date, point, axis })
            }
          />
        ) : (
          // 週表示のセルは列=日付でスタッフが定まらないため、日付と時刻だけを
          // 初期値にしてスタッフ未選択でダイアログを開く(誰が空いているかは
          // ダイアログ内でスタッフを選べば空き時間一覧・空き判定で分かる)
          <WeekGrid
            staff={staff}
            weekView={weekView}
            onSelect={setSelectedId}
            onCreateAt={(dayDate, point, axis) =>
              openCreateAt({ date: dayDate, point, axis })
            }
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

      {createTarget !== null && (
        <ProxyRegistrationDialog
          staff={staff}
          menus={menus}
          target={createTarget}
          onClose={() => setCreateTarget(null)}
          onSuccess={() => {
            // 遷移せずカレンダーを取り直す = 登録した予約がその場で現れる
            setCreateTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 日表示
// ---------------------------------------------------------------------------

/**
 * 列(relative なコンテナ。日表示はスタッフ列・週表示は日付列)の中で押された
 * 位置と、列・グリッドの横位置。
 * - ratio: 列内の縦位置 0〜1(→ 時刻への変換は純粋関数 timeFromTimelineRatio)
 * - column/grid の左右X(→ ダイアログの初期位置は純粋関数 dialogInitialX)
 * DOM計測はUI層の責務。判断は純粋関数に任せる。
 */
type ColumnClickPoint = {
  ratio: number;
  columnLeft: number;
  columnRight: number;
  gridLeft: number;
  gridRight: number;
};

function columnClickPoint(
  event: React.MouseEvent<HTMLElement>,
): ColumnClickPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  // 列グリッド全体 = 押された列の親要素。PC/タブレットの日表示では
  // DayTimelineGrid の grid コンテナ(全スタッフ列の直接の親)、週表示では
  // WeekGrid の grid-cols-7 コンテナ(7日分の列の直接の親)がこれにあたる。
  // 親が取れない場合は列自身をグリッド全体とみなす(dialogInitialX 側で
  // 反対側の領域が 0 になり、クランプで画面内に収まる)。
  // スマホの1列表示は親に時間目盛りを含むが、md未満はシート表示で初期位置を
  // 使わないため影響しない。
  const gridRect =
    event.currentTarget.parentElement?.getBoundingClientRect() ?? rect;
  return {
    ratio: rect.height <= 0 ? 0 : (event.clientY - rect.top) / rect.height,
    columnLeft: rect.left,
    columnRight: rect.right,
    gridLeft: gridRect.left,
    gridRight: gridRect.right,
  };
}

/** 空き枠クリックの共通スタイル(押せることが分かる程度の軽い視覚フィードバック) */
const emptySlotClass = "cursor-pointer transition-colors hover:bg-muted/40";

function DayView({
  staff,
  timeline,
  listItems,
  onSelect,
  onCreateAt,
}: {
  staff: AdminStaff[];
  timeline: DayTimeline;
  listItems: ReservationListItem[];
  onSelect: (id: string) => void;
  onCreateAt: (
    staffId: string,
    point: ColumnClickPoint,
    axis: TimelineAxis,
  ) => void;
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
          onCreateAt={onCreateAt}
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
          <MobileTimeline
            timeline={timeline}
            onSelect={onSelect}
            onCreateAt={onCreateAt}
          />
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
  onCreateAt,
}: {
  staff: AdminStaff[];
  timeline: DayTimeline;
  onSelect: (id: string) => void;
  onCreateAt: (
    staffId: string,
    point: ColumnClickPoint,
    axis: TimelineAxis,
  ) => void;
}) {
  const axis = timeline.axis;
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
              // 列の空き領域クリックで代行登録ダイアログを開く(電話を受けながら
              // 空きを押してその場で登録するための導線)。予約カードは
              // stopPropagation するので、カード上は従来どおり予約詳細が開く。
              // 休憩・予約不可の上は登録ダイアログでよい(店側は休憩を削って
              // 受けられる)。キーボード操作の導線はサイドバーの「代行登録」
              // ページが担うため、ここはポインタ操作の近道として置く
              <div
                key={column.staffId}
                onClick={
                  axis === null
                    ? undefined
                    : (event) =>
                        onCreateAt(
                          column.staffId,
                          columnClickPoint(event),
                          axis,
                        )
                }
                className={cn(
                  "relative border-l border-border",
                  axis !== null && emptySlotClass,
                )}
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
  onCreateAt,
}: {
  timeline: DayTimeline;
  onSelect: (id: string) => void;
  onCreateAt: (
    staffId: string,
    point: ColumnClickPoint,
    axis: TimelineAxis,
  ) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const height = timelineHeight(timeline.tickMarks);
  const column = timeline.columns[selectedIndex];
  const axis = timeline.axis;

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
        {/* 空きをタップすると代行登録ダイアログ(スタッフは上のセグメントで選択中の1名) */}
        <div
          onClick={
            axis === null
              ? undefined
              : (event) =>
                  onCreateAt(column.staffId, columnClickPoint(event), axis)
          }
          className={cn(
            "relative flex-1 border-l border-border",
            axis !== null && emptySlotClass,
          )}
        >
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
  onCreateAt,
}: {
  staff: AdminStaff[];
  weekView: WeekView;
  onSelect: (id: string) => void;
  /** 日付列の空き領域クリック(スタッフはダイアログ内で選ぶので渡さない) */
  onCreateAt: (
    date: string,
    point: ColumnClickPoint,
    axis: TimelineAxis,
  ) => void;
}) {
  const colorIndexByStaffId = new Map(
    staff.map((member, index) => [member.id, index]),
  );
  // 週表示は1日1列に全スタッフを並べるため、カードだけでは担当が色でしか
  // 分からない。ツールチップに担当名を添えるための引き当て表
  const staffNameById = new Map(
    staff.map((member) => [member.id, member.name]),
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
  const axis = weekView.axis;

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
                // 日付列の空き領域クリックで代行登録ダイアログを開く。週表示は
                // 列=日付で全スタッフが同じ列に並ぶためスタッフは決まらない。
                // 日付・時刻だけを初期値にして開き、スタッフはダイアログ内で選ぶ
                // (選んだ時点でその日の空き時間一覧・空き判定が出る)。
                // 予約カードは stopPropagation するので、カード上は従来どおり
                // 予約詳細ダイアログが開く。定休日の列も開いてよい(フォームと
                // サーバーの「定休日は登録できません」ガードが働く。日表示と同じ)
                <div
                  key={day.date}
                  onClick={
                    axis === null
                      ? undefined
                      : (event) =>
                          onCreateAt(day.date, columnClickPoint(event), axis)
                  }
                  className={cn(
                    "relative border-l border-border",
                    // 定休日: 斜線ハッチングは実機で見分けがつきにくかったため、
                    // べた塗りの背景色に変更。--secondary はページ背景(--background)
                    // に対してライト 0.93/0.965、ダーク 0.269/0.145 と明度差があり、
                    // 不透明度を下げずに敷くことで一目で休みだと分かる。色はトークンのみ
                    day.isClosed && "bg-secondary",
                    axis !== null && emptySlotClass,
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
                        // 日付列の空き領域クリック(代行登録ダイアログ)へ
                        // 伝播させない。カードの上は従来どおり予約詳細を開く
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(item.id);
                        }}
                        // 重なりで幅が狭くなると文字が切れるため、完全な情報を
                        // ネイティブのツールチップで補う(クリックの詳細ダイアログは従来どおり)
                        title={weekItemTooltip(
                          item,
                          staffNameById.get(item.staffId),
                        )}
                        className={cn(
                          // ring は定休日の下地(bg-secondary)と同色のカード
                          // (staff-colors の3人目)でも輪郭が消えないようにする
                          "absolute overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left ring-1 ring-border transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          staffColor(colorIndex).card,
                        )}
                        // 横位置は重なりのレーン分割(admin-calendar.ts)が決める。
                        // 左右2pxずつ削るのは従来の inset-x-0.5 と同じ見た目にするためで、
                        // 幅を分け合ったときは隣との間に4pxの間隔ができる
                        // (加えて ring-1 ring-border で輪郭が分かる)
                        style={{
                          top: `${item.topPercent}%`,
                          height: `${item.heightPercent}%`,
                          left: `calc(${item.leftPercent}% + 2px)`,
                          width: `calc(${item.widthPercent}% - 4px)`,
                        }}
                      >
                        <p className="truncate text-xs font-bold">
                          {item.titleLabel}
                        </p>
                        {/* 日表示のカードと同じ理由で、スタッフ色の下地に対して
                            薄すぎる muted-foreground を使わない(timeline-column.tsx) */}
                        {item.menuLabel !== null && (
                          <p className="truncate text-xs text-foreground/75">
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
