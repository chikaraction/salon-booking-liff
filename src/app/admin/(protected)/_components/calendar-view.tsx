"use client";

// 予約カレンダーの表示(配線に徹する)。日/週の配置計算は
// src/lib/admin-calendar.ts が済ませており、ここは受け取った結果を描画し、
// ナビゲーションをURL遷移(?view=&date=)に変換するだけ。
// 色はスタッフの並び順から src/lib/staff-colors.ts が決める(ADR-007)。

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  dayNavLabel,
  moveDay,
  shouldFollowDate,
  timeFromTimelineRatio,
  weekItemTooltip,
  weekNavLabel,
  weekStartOf,
  weekdayLabel,
  type AdminStaff,
  type ColumnAnchor,
  type DayTimeline,
  type ReservationListItem,
  type TimelineAxis,
  type WeekView,
} from "@/lib/admin-calendar";
import { restoreSelectableMenuIds } from "@/lib/admin-reservation-form";
import {
  isCalendarDate,
  jstCalendarDate,
  jstClockTime,
} from "@/lib/availability";
import { cn } from "@/lib/utils";
import type { ActiveMenu, ReservationDetail } from "@/server/admin-data";

import { ReservationDetailDialog } from "./reservation-detail-dialog";
import {
  ReservationFormDialog,
  type ProxyRegistrationTarget,
  type ReservationDialogTarget,
  type ReservationEditTarget,
} from "./reservation-form-dialog";
import { staffColor } from "@/lib/staff-colors";
import {
  cardColumnAnchor,
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

  // 開いているダイアログは常に1つだけにする(下の3状態は排他):
  // - 詳細(selectedId): モーダル。背景を覆うのでカレンダーは操作できない
  // - 代行登録(createTarget)・変更(editTarget): 非モーダルのフォームダイアログ。
  //   オーバーレイを敷かない(背後のカレンダーを見ながら操作するのが要件)ので、
  //   開いている間はカレンダーのクリック配線そのものを外す。下の formOpen を参照

  // 選択中の予約ID(カレンダーの予約カードをクリックすると詳細ダイアログを開く)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 詳細を開いたきっかけの予約カードが載っていた列(変更ダイアログの初期位置に使う)。
  // スマホのリスト表示など列が分からない経路では null
  const [selectedAnchor, setSelectedAnchor] = useState<ColumnAnchor | null>(
    null,
  );
  // 空き枠クリックで開く代行登録ダイアログの対象(スタッフ・日付・時刻)
  const [createTarget, setCreateTarget] =
    useState<ProxyRegistrationTarget | null>(null);
  // 詳細の「変更」で開く変更ダイアログの対象(取得済みの詳細から組み立てる)
  const [editTarget, setEditTarget] = useState<ReservationEditTarget | null>(
    null,
  );

  /** 代行登録・変更ダイアログを閉じる(排他なのでまとめて畳む) */
  const closeFormDialog = () => {
    setCreateTarget(null);
    setEditTarget(null);
  };

  /** 予約カード・リスト項目のクリック → 詳細ダイアログ(列の座標も覚えておく) */
  const openDetail = (id: string, anchor: ColumnAnchor | null) => {
    setSelectedId(id);
    setSelectedAnchor(anchor);
  };

  /**
   * 予約詳細の「変更」→ 変更ダイアログ。詳細ダイアログは閉じる(排他)。
   * 詳細は取得済みなので再取得しない。開始時刻(UTC)→ JSTの日付・時刻の分解、
   * 初期選択メニューの復元(無効化されたメニューの除外)は、変更ページ
   * (/admin/reservations/[id]/edit)と同じ純粋関数に任せる。
   * 初期位置は代行登録と同じロジック(押した列以外の領域の中央)にするため、
   * 詳細を開いたときに測っておいた列の座標(selectedAnchor)を載せる。
   */
  const openEdit = (detail: ReservationDetail) => {
    setSelectedId(null);
    setCreateTarget(null);
    setEditTarget({
      anchor: selectedAnchor,
      mode: "edit",
      reservationId: detail.id,
      customerName: detail.customerName,
      staffId: detail.staffId,
      date: jstCalendarDate(detail.start),
      time: jstClockTime(detail.start),
      menuIds: restoreSelectableMenuIds(
        detail.menuIds,
        menus.map((menu) => menu.id),
      ),
      note: detail.requestNote ?? "",
    });
  };

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
   * フォームダイアログが開いている間はこのハンドラ自体を配線しない(formOpen)
   * ので、入力途中のクリックでフォームが作り直されて入力が消えることはない。
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
    const { point } = params;
    setCreateTarget({
      mode: "create",
      staffId: params.staffId,
      date: params.date,
      time: timeFromTimelineRatio({
        ratio: point.ratio,
        ...params.axis,
        intervalMinutes: slotIntervalMinutes,
      }),
      anchor: {
        columnLeft: point.columnLeft,
        columnRight: point.columnRight,
        gridLeft: point.gridLeft,
        gridRight: point.gridRight,
      },
    });
  };

  const go = (nextView: "day" | "week", nextDate: string) => {
    router.push(`/admin?view=${nextView}&date=${nextDate}`);
  };

  /**
   * フォームの日付が変わったら、背後のカレンダーをその日付へ追従させる
   * (非モーダルの狙い = 背後を見ながら操作する、が「変更先の日が背後に
   * 出ていない」と成立しないため)。表示種別(日/週)は変えない = 週表示なら
   * その日付を含む週になる(週の起点は page.tsx / ラベルの weekStartOf が決める)。
   * すでに見えている(日表示で同じ日・週表示で同じ週)なら何もしない。
   * 手動の日付移動(‹ › ・日付ピッカー・日/週トグル)は従来どおり go() のまま。
   *
   * push ではなく replace:
   * - 追従は利用者が意図した「移動」ではないので、戻るボタンの履歴に
   *   1文字入力ごとの日付を積みたくない
   * scroll: false:
   * - 時間軸のスクロール位置(見ていた時間帯)を保ったまま日付だけ差し替える
   *
   * ダイアログの入力が消えないのは、これが同一ルート(/admin)のクエリだけの
   * 遷移だから: サーバーコンポーネントは再実行されるが、返す要素は常に
   * <CalendarView>(型・位置・key とも不変)なので、この CalendarView は
   * 再マウントされず createTarget / editTarget / ダイアログ位置を保つ。
   * ダイアログとフォームの key も自前の state 由来で遷移では変わらない。
   */
  const followFormDate = (nextDate: string) => {
    if (!shouldFollowDate({ view, currentDate: date, nextDate })) return;
    router.replace(`/admin?view=${view}&date=${nextDate}`, { scroll: false });
  };

  const isToday =
    view === "day"
      ? date === todayDate
      : weekStartOf(date) === weekStartOf(todayDate);

  const centerLabel =
    view === "day" ? dayNavLabel(date) : weekNavLabel(weekStartOf(date));

  // 描画するフォームダイアログ(排他。変更を優先する)
  const formTarget: ReservationDialogTarget | null = editTarget ?? createTarget;

  // フォームダイアログを開いている間は、背後のカレンダーのクリック配線を外す。
  // 全面の透明オーバーレイは使わない: 背後のスクロール・日付移動まで塞いでしまい、
  // 「背後のカレンダーを見ながら操作する」という非モーダルの設計意図が壊れるため。
  // ヘッダーの ‹ › ・日付ピッカー・日/週トグル・スクロールは引き続き使える。
  // ハンドラを渡さないことで、押せる見た目(cursor-pointer・ホバー)も消える
  const formOpen = formTarget !== null;

  const handlePrev = () => go(view, moveDay(date, view === "day" ? -1 : -7));
  const handleNext = () => go(view, moveDay(date, view === "day" ? 1 : 7));

  return (
    // 予約カレンダーの地は白(--card。モックB・B-2・H)。ほかの管理ページは
    // ページ背景(--background)+白いカードのまま。罫線・見出しの地の色は
    // globals.css の --calendar-divider / --calendar-header / --grid-line。
    // スマホは AdminSidebar の上部バー(h-14)の下に置かれるので、その分を
    // 引いて画面に収める(ページ側の縦スクロールとの二重スクロールを防ぐ)。
    // 上部バーの高さを変えたらここも合わせる
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-card md:h-screen">
      {/* ヘッダー(前後ナビ + 日付ピッカー + 今日 + 日/週トグル) */}
      <header className="flex flex-wrap items-center gap-3 border-b border-calendar-divider px-4 py-3 md:px-6">
        {/* 可視の見出しは日付ピッカーが兼ねる(日付の二重表示を避ける)。
            ページ見出しとしては読み上げ用に残す */}
        <h1 className="sr-only">{centerLabel}</h1>

        {/* ‹ › が日付ピッカーを左右から挟む(移動対象が一目で分かる)。
            スマホ幅(sm 未満)は1行に収まらないので、1行目を ‹ 日付 › に充て、
            今日・日/週を2行目に回す。日付欄は flex-1 で伸ばす(iOS は % 幅の
            日付入力を content-box にしてはみ出すので w-full は使わない) */}
        <div className="flex items-center gap-1 max-sm:w-full">
          <button
            type="button"
            onClick={handlePrev}
            aria-label={view === "day" ? "前の日" : "前の週"}
            className="flex size-9 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>

          {/* 日付ジャンプ(‹ › は1日/1週ずつなので、遠い日付へは直接指定する)。
              iOS・Android の日付入力にはピッカーのアイコンが出ない(WebKit・
              モバイルの Chromium は描かない)ので、押せると分かるよう自前で描く。
              PC の Chromium のアイコンは透明にして同じ位置に重ね、押すと
              ピッカーが開くのは従来どおり。Firefox は独自のボタンを出すので
              自前のほうを隠す */}
          <span className="relative flex max-sm:min-w-0 max-sm:flex-1">
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
              className={cn(
                "relative h-9 w-[9.5rem] rounded-lg border border-input bg-card pr-8 pl-2 text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                "max-sm:min-w-0 max-sm:flex-1",
                "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-2 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:my-auto [&::-webkit-calendar-picker-indicator]:size-4 [&::-webkit-calendar-picker-indicator]:p-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
              )}
            />
            <CalendarDays
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-[9px] my-auto size-4 text-muted-foreground supports-[-moz-orient:inherit]:hidden"
            />
          </span>

          {/* 日表示: ネイティブの日付入力は曜日を出さない。定休日の判断に要るので添える。
              週表示: 曜日ではなく ‹ › が動かす単位(週)を示す */}
          <span className="text-sm text-muted-foreground">
            {view === "day" ? `(${weekdayLabel(date)})` : "週"}
          </span>

          <button
            type="button"
            onClick={handleNext}
            aria-label={view === "day" ? "次の日" : "次の週"}
            className="flex size-9 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>

        {/* 「今日」は当日以外を表示しているときこそ押したいボタンなので、
            塗りの有無に関わらず常に枠線付きで出す(塗りが無いときに
            ただの文字列に見えると、押せることに気づけない)。
            高さ・角丸・枠線は隣の ‹ › ・日付ピッカー(h-9 / rounded-lg /
            border-input、ピッカーは bg-card)に揃える。枠の色はモックB の
            ツールバーの操作部品(#d5d2ca = --input)。
            当日を表示中かどうかは塗りと枠線の色で示す:
            - 当日: --accent の塗り + 「選択状態」の色である --primary の枠線
              (ダークでは --accent と --muted が同値なので、下の hover と
              紛れないように枠線でも差を付ける)
            - 当日以外: ピッカーと同じ bg-card + 通常の文字色、ホバーで淡い下地 */}
        <button
          type="button"
          onClick={() => go(view, todayDate)}
          aria-current={isToday ? "date" : undefined}
          className={cn(
            "h-9 rounded-lg border px-3 text-sm font-bold transition-colors",
            isToday
              ? "border-primary bg-accent text-primary-strong"
              : "border-input bg-card text-foreground hover:bg-muted",
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

        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-input p-0.5">
          {(["day", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => go(option, date)}
              aria-pressed={view === option}
              className={cn(
                // モックのトグル・チップ類は選択中・未選択とも font-weight:700
                "h-7 rounded-md px-3 text-sm font-bold transition-colors",
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

      {/* スマホのリスト表示(モックI)だけは、地をページ背景にして白いカードを
          並べる。切替の状態は DayView の中にあるため、リストの目印
          (data-calendar-list)の有無で地を切り替える。リストは md 未満でしか
          表示しないので max-md に限る(md 以上では非表示のまま残ることがある) */}
      <div className="min-h-0 flex-1 overflow-auto max-md:has-[[data-calendar-list]]:bg-background">
        {view === "day" ? (
          <DayView
            staff={staff}
            timeline={timeline}
            listItems={listItems}
            onSelect={formOpen ? undefined : openDetail}
            onCreateAt={
              formOpen
                ? undefined
                : (staffId, point, axis) =>
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
            todayDate={todayDate}
            onSelect={formOpen ? undefined : openDetail}
            onCreateAt={
              formOpen
                ? undefined
                : (dayDate, point, axis) =>
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
          onEdit={openEdit}
        />
      )}

      {/* 代行登録・変更は同じフォームダイアログ(非モーダル・ドラッグ可)。
          排他なので変更を優先して1つだけ描く。key で用途・対象予約が変わったら
          作り直す(前の入力値が残らないように) */}
      {formTarget !== null && (
        <ReservationFormDialog
          key={
            editTarget !== null ? `edit-${editTarget.reservationId}` : "create"
          }
          staff={staff}
          menus={menus}
          target={formTarget}
          onClose={closeFormDialog}
          onDateChange={followFormDate}
          onSuccess={() => {
            // 遷移せずカレンダーを取り直す = 登録・変更の結果がその場で現れる
            closeFormDialog();
            router.refresh();
          }}
          onBack={
            editTarget === null
              ? undefined
              : () => {
                  // 変更をやめて詳細に引き返す(店側キャンセルの「戻る」と同じ体験)
                  const backTo = editTarget.reservationId;
                  setEditTarget(null);
                  setSelectedId(backTo);
                }
          }
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

/**
 * 空き枠クリックの共通スタイル(押せることが分かる程度の軽い視覚フィードバック)。
 * 半透明にして下の1時間罫線(--grid-line)を透かす。--muted は白に近く(#f7f6f3)
 * 半透明では見えないため、チップの地(--secondary)を半分の濃さで敷く
 */
const emptySlotClass = "cursor-pointer transition-colors hover:bg-secondary/50";

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
  /** 省略 = フォームダイアログが開いている間。予約カードを押せなくする */
  onSelect?: (id: string, anchor: ColumnAnchor | null) => void;
  /** 省略 = フォームダイアログが開いている間。空き枠を押せなくする */
  onCreateAt?: (
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
        {/* リスト表示で地がページ背景になっても、ここはツールバーの続きとして白 */}
        <div className="flex gap-0.5 border-b border-calendar-divider bg-card p-3">
          {(["timeline", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMobileMode(mode)}
              aria-pressed={mobileMode === mode}
              className={cn(
                "h-9 flex-1 rounded-lg text-sm font-bold transition-colors",
                // 未選択はモックH のスタッフ切替と同じチップの地(--secondary)
                mobileMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground",
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
          // data-calendar-list: CalendarView がスクロール領域の地を
          // ページ背景に切り替える目印(モックI)
          <div data-calendar-list>
            <ReservationList listItems={listItems} onSelect={onSelect} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * 定休日でも予約があるときに、タイムライン上部へ添える定休日バッジ。
 * 定休日への新規登録はブロックされるが、過去・別経路の予約は表示・確認できる。
 * 地は週表示の定休日と同じ --calendar-closed(帯は半分の濃さ、バッジはべた塗り)
 */
function ClosedDayBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-calendar-divider bg-calendar-closed/50 px-4 py-2 md:px-6">
      <span className="rounded-md bg-calendar-closed px-2 py-0.5 text-xs font-bold text-muted-foreground">
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
  onSelect?: (id: string, anchor: ColumnAnchor | null) => void;
  onCreateAt?: (
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
    // pb-5: 末尾(閉店時刻)のラベルは罫線の直下=時間軸の外へ1行分
    // (mt-0.5 + text-xs ≒ 1.125rem)はみ出すので、本体の外側の下に余白を取る。
    // 本体の高さを増やすと列の矩形(空き枠クリックの縦比率→時刻)がずれるため外側に置く
    <div className="min-w-max pb-5 md:min-w-0">
      {/* 列見出し(モックB: 見出しの地は --calendar-header、時刻列の上は白のまま)。
          縦スクロールでスタッフ名が流れないよう上に固定する(bg-card は本体が
          透けないため、z は週表示と同じ並び)。md 以上は横スクロールが無いので
          時刻列は左に固定しない */}
      <div className="sticky top-0 z-20 flex border-b border-calendar-divider bg-card">
        <div className="w-16 shrink-0 bg-card" />
        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: gridColumns }}
        >
          {timeline.columns.map((column) => (
            <div
              key={column.staffId}
              className="border-l border-calendar-divider bg-calendar-header px-3 py-2 text-center text-sm font-bold"
            >
              {column.heading}
            </div>
          ))}
        </div>
      </div>

      {/* 本体 */}
      <div className="flex" style={{ height }}>
        <div className="relative w-16 shrink-0">
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
                  axis === null || onCreateAt === undefined
                    ? undefined
                    : (event) =>
                        onCreateAt(
                          column.staffId,
                          columnClickPoint(event),
                          axis,
                        )
                }
                className={cn(
                  "relative border-l border-calendar-divider",
                  axis !== null && onCreateAt !== undefined && emptySlotClass,
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
  onSelect?: (id: string, anchor: ColumnAnchor | null) => void;
  onCreateAt?: (
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
              // 未選択はモックH(#f2f0ea)どおりチップの地(--secondary)
              selectedIndex === index
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {col.heading}
          </button>
        ))}
      </div>

      {/* pb-6 が末尾(閉店時刻)のラベルの余白を兼ねる。box-sizing: border-box
          なので pb-6 は height の内側にあり、列・目盛りは pb-6 の上で終わる。
          罫線の直下=時間軸の外へ1行分(mt-0.5 + text-xs ≒ 1.125rem)はみ出す
          末尾のラベルは、この 1.5rem に収まる(余白を足すと二重になるので足さない) */}
      <div className="flex px-3 pb-6" style={{ height }}>
        <div className="relative w-16 shrink-0">
          <TimeGutter tickMarks={timeline.tickMarks} />
        </div>
        {/* 空きをタップすると代行登録ダイアログ(スタッフは上のセグメントで選択中の1名) */}
        <div
          onClick={
            axis === null || onCreateAt === undefined
              ? undefined
              : (event) =>
                  onCreateAt(column.staffId, columnClickPoint(event), axis)
          }
          className={cn(
            "relative flex-1 border-l border-calendar-divider",
            axis !== null && onCreateAt !== undefined && emptySlotClass,
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
  /** 省略 = フォームダイアログが開いている間。項目を押せなくする */
  onSelect?: (id: string, anchor: ColumnAnchor | null) => void;
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
            // リスト表示は列の座標が無いので anchor は null(変更ダイアログは
            // 右寄せにフォールバックする)。ダイアログを開いている間は
            // onSelect が渡らないので押せない
            disabled={onSelect === undefined}
            onClick={
              onSelect === undefined ? undefined : () => onSelect(item.id, null)
            }
            className={cn(
              // 枠はモックI の淡い枠(#ece9e3 ≒ --calendar-divider)
              "flex w-full items-start gap-4 rounded-xl border border-calendar-divider bg-card p-4 text-left",
              onSelect !== undefined &&
                "transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span className="w-14 shrink-0 text-base font-bold text-primary-strong">
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
  todayDate,
  onSelect,
  onCreateAt,
}: {
  staff: AdminStaff[];
  weekView: WeekView;
  /** 今日(JST)。曜日見出しで今日の列を示す */
  todayDate: string;
  /** 省略 = フォームダイアログが開いている間。予約カードを押せなくする */
  onSelect?: (id: string, anchor: ColumnAnchor | null) => void;
  /**
   * 日付列の空き領域クリック(スタッフはダイアログ内で選ぶので渡さない)。
   * 省略 = フォームダイアログが開いている間。空き枠を押せなくする
   */
  onCreateAt?: (
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
    // 縦横のスクロールは親(CalendarView の overflow-auto)1つに任せる。
    // ここに横専用のスクロール領域(overflow-x-auto)を挟むと、見出しの
    // sticky top の基準が縦に動かないその箱になり、縦に固定できない。
    // pb-5: 末尾(閉店時刻)のラベルは罫線の直下=時間軸の外へ1行分
    // (mt-0.5 + text-xs ≒ 1.125rem)はみ出すので、本体の外側の下に余白を取る
    // (本体の高さを増やすと列の矩形=空き枠クリックの時刻がずれるため外側)
    <div className="min-w-[48rem] pb-5">
      {/* 曜日見出し。縦横にスクロールしてもどの日か分かるよう上に固定する。
          bg-card は下を流れる本体が透けないため。重なり順は
          本体の帯・予約カード(z なし)< 時刻列(z-10)< 見出し行(z-20)<
          ダイアログ(z-50) */}
      <div className="sticky top-0 z-20 flex border-b border-calendar-divider bg-card">
        {/* 左上の角。横スクロールで見出しのセルがこの下に潜るよう左にも固定する。
            右端の線は影で描く(スクロールしていないときは1日目の列の
            border-l と重なるので二重線にならず、幅も変わらない) */}
        <div className="sticky left-0 z-10 w-16 shrink-0 bg-card shadow-[1px_0_0_var(--color-calendar-divider)]" />
        <div className="grid flex-1 grid-cols-7">
          {weekView.days.map((day) => (
            <div
              key={day.date}
              aria-current={day.date === todayDate ? "date" : undefined}
              className={cn(
                "border-l border-calendar-divider px-2 py-2 text-center text-sm font-bold",
                // 見出しの地は3択で排他にする(クラスの後勝ちに頼らない)。
                // 優先順: 定休日 > 今日 > 通常
                day.isClosed
                  ? // 定休日は本体セルと同じ下地を敷き、列全体が休みだと一目で分かるようにする
                    "bg-calendar-closed text-muted-foreground"
                  : day.date === todayDate
                    ? // 今日の列の見出しはテーマの淡色(モックB-2)
                      "bg-accent"
                    : // 通常の見出しはモックB-2 の淡い地
                      "bg-calendar-header",
              )}
            >
              {day.dayNumber} {day.weekdayLabel}
            </div>
          ))}
        </div>
      </div>

      {/* 本体 */}
      <div className="flex" style={{ height }}>
        {/* 時刻列。横スクロールしても何時か分かるよう左に固定する(角と同じ
            bg-card・影の線)。sticky は位置指定済みなので、TimeGutter の
            absolute のラベルの基準は引き続きこの div */}
        <div className="sticky left-0 z-10 w-16 shrink-0 bg-card shadow-[1px_0_0_var(--color-calendar-divider)]">
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
                  axis === null || onCreateAt === undefined
                    ? undefined
                    : (event) =>
                        onCreateAt(day.date, columnClickPoint(event), axis)
                }
                className={cn(
                  "relative border-l border-calendar-divider",
                  // 定休日: 斜線ハッチングは実機で見分けがつきにくかったため、
                  // べた塗りの背景色に変更。--calendar-closed はカレンダーの地
                  // (--card、白)に対して明度 0.93/1.0 と差があり、不透明度を
                  // 下げずに敷くことで一目で休みだと分かる。色はトークンのみ
                  day.isClosed && "bg-calendar-closed",
                  axis !== null && onCreateAt !== undefined && emptySlotClass,
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
                {/* その日の営業時間外(軸は週内の最小開店〜最大閉店なので、
                      他の曜日より早く閉まる日の閉店後などが軸に残る)。
                      定休日の下地(bg-calendar-closed のべた塗り)と同じ色をちょうど
                      半分の濃さで敷き、「開かない日(濃い・列全体+定休日ラベル)」と
                      「営業しているが時間外(淡い・一部の時間帯だけ)」を区別する。
                      新しい色は足さない(ADR-006: トークンのみ)。
                      半透明なので下の1時間罫線も透けて読める。
                      位置(top%/height%)は純粋関数 offHoursBands が決める。
                      装飾なので aria-hidden(読み上げる意味は無く、登録可否は
                      ダイアログの空き判定メッセージが担う)。クリックは従来どおり
                      背後の日付列に通す(pointer-events-none)。予約カード・
                      グリッド線より背面に置くため、カードより先に描く */}
                {day.offHoursBands.map((band) => (
                  <div
                    key={band.topPercent}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bg-calendar-closed/50"
                    style={{
                      top: `${band.topPercent}%`,
                      height: `${band.heightPercent}%`,
                    }}
                  />
                ))}
                {day.items.map((item) => {
                  const colorIndex = colorIndexByStaffId.get(item.staffId) ?? 0;
                  const className = cn(
                    // ring は下地の明るいカード(2人目のニュートラルなど)でも、
                    // 定休日・営業時間外の下地(bg-calendar-closed)の上で輪郭が
                    // 消えないようにする。色はその下地の上でも見える
                    // --calendar-closed-line(--border #e7e4dd は下地と明度がほぼ同じ)
                    "absolute overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left ring-1 ring-calendar-closed-line",
                    // 日表示のカード(timeline-column.tsx)と同じ理由で、
                    // button 既定の上下中央寄せを打ち消して常に上詰めにする
                    "flex flex-col items-stretch justify-start",
                    staffColor(colorIndex).card,
                    // 押せるときだけホバー・フォーカスの見た目を出す
                    // (フォームダイアログを開いている間は押せない)
                    onSelect !== undefined &&
                      "transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  );
                  // 横位置は重なりのレーン分割(admin-calendar.ts)が決める。
                  // 左右2pxずつ削るのは従来の inset-x-0.5 と同じ見た目にするためで、
                  // 幅を分け合ったときは隣との間に4pxの間隔ができる
                  // (加えて ring-1 ring-calendar-closed-line で輪郭が分かる)
                  const style = {
                    top: `${item.topPercent}%`,
                    height: `${item.heightPercent}%`,
                    left: `calc(${item.leftPercent}% + 2px)`,
                    width: `calc(${item.widthPercent}% - 4px)`,
                  };
                  // 重なりで幅が狭くなると文字が切れるため、完全な情報を
                  // ネイティブのツールチップで補う(押せないときも読める)
                  const tooltip = weekItemTooltip(
                    item,
                    staffNameById.get(item.staffId),
                  );
                  const content = (
                    <>
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
                    </>
                  );

                  // 押せないときは button ではなく div にする(日表示の
                  // TimelineBlocks と同じ作法。フォーカスも当たらない)
                  if (onSelect === undefined) {
                    return (
                      <div
                        key={item.id}
                        title={tooltip}
                        className={className}
                        style={style}
                      >
                        {content}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={item.id}
                      type="button"
                      // 日付列の空き領域クリック(代行登録ダイアログ)へ
                      // 伝播させない。カードの上は従来どおり予約詳細を開く。
                      // 列とグリッドの座標も渡し、変更ダイアログを代行登録と
                      // 同じ位置(押した列以外の領域の中央)に出せるようにする
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(item.id, cardColumnAnchor(event));
                      }}
                      title={tooltip}
                      className={className}
                      style={style}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
