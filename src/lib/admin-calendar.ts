// 管理画面の予約カレンダー(M4)の判断ロジック(純粋関数)。
// 日表示の配置計算・週表示への集約・日付ナビゲーション・
// 代行登録の空き判定メッセージ・予約リスト表示(スマホ)の整形を扱う。
// 日時の前提は availability.ts / booking.ts と同じ(JST = UTC+9 固定)。
// EXCLUDE制約(ADR-004)により confirmed 同士は重ならない前提のため、
// 重なり回避レイアウトは行わない。

import {
  addCalendarDays,
  calendarWeekday,
  jstCalendarDate,
  jstDateTime,
  type BusinessDay,
  type BusyRange,
  type Slot,
  type StaffWorkingDay,
} from "./availability";
import {
  formatJstDateTimeLabel,
  formatYen,
  menuNamesLabel,
  summarizeSelectedMenus,
} from "./booking";
import { calendarDateLabel, formatJstTime } from "./calendar";
import type { ReservationMenuSnapshot } from "./my-reservations";

const MINUTE_MS = 60 * 1000;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// モック準拠の表示しきい値:
// - 所要分「(150分)」は60分(目盛り1コマ)以下のブロックでは省略する
// - 料金は高さに余裕があるブロックだけに表示する(モックで料金が出ているのは
//   150分ブロックのみ。120分では出ていない)
const DURATION_LABEL_MIN_MINUTES = 61;
const PRICE_LABEL_MIN_MINUTES = 150;

// ---------------------------------------------------------------------------
// 入力の型(src/server/ のアダプタ層がDB行から変換して渡す)
// ---------------------------------------------------------------------------

export type AdminStaff = {
  id: string;
  name: string;
  role: "owner" | "staff";
};

/** 確定済みの予約1件(kind=booking。メニュースナップショット込み) */
export type AdminBooking = {
  kind: "booking";
  id: string;
  staffId: string;
  during: BusyRange;
  customerName: string;
  menus: ReservationMenuSnapshot[];
};

/** 予約不可ブロック1件(kind=block。臨時休など) */
export type AdminBlock = {
  kind: "block";
  id: string;
  staffId: string;
  during: BusyRange;
};

export type AdminCalendarItem = AdminBooking | AdminBlock;

// ---------------------------------------------------------------------------
// 時刻の内部ヘルパ(壁時計の分数で扱う)
// ---------------------------------------------------------------------------

/** "HH:MM" / "HH:MM:SS" を0時からの分数に変換する */
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 0時からの分数を「13:00」形式にする(時は先頭0なし・分は2桁) */
function minutesLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** UTCのDateを対象日(JST)の0時からの分数に変換する */
function jstMinutesOfDay(date: string, at: Date): number {
  const midnight = jstDateTime(date, "00:00");
  return Math.round((at.getTime() - midnight.getTime()) / MINUTE_MS);
}

/** 時間目盛り1つ分(ラベルと時間軸上の位置%。グリッド線の描画用) */
export type TickMark = {
  label: string;
  topPercent: number;
};

/**
 * 営業時間(分数)に合わせた1時間刻みの目盛りを生成する。
 * 開店が正時でない場合、最初の目盛りは開店位置(0%)より下になる。
 */
function hourTickMarks(openMinutes: number, closeMinutes: number): TickMark[] {
  const total = closeMinutes - openMinutes;
  if (total <= 0) return [];
  const marks: TickMark[] = [];
  for (let t = Math.ceil(openMinutes / 60) * 60; t <= closeMinutes; t += 60) {
    marks.push({
      label: minutesLabel(t),
      topPercent: ((t - openMinutes) * 100) / total,
    });
  }
  return marks;
}

/** 時間軸([open, close] 分数)上の区間を top%・height% に変換する。範囲外は null */
function placeOnAxis(
  startMinutes: number,
  endMinutes: number,
  openMinutes: number,
  closeMinutes: number,
): { topPercent: number; heightPercent: number } | null {
  const total = closeMinutes - openMinutes;
  if (total <= 0) return null;
  // 営業時間の外にはみ出す分は切り詰める
  const start = Math.max(startMinutes, openMinutes);
  const end = Math.min(endMinutes, closeMinutes);
  if (end <= start) return null;
  return {
    topPercent: ((start - openMinutes) * 100) / total,
    heightPercent: ((end - start) * 100) / total,
  };
}

// ---------------------------------------------------------------------------
// 1. 日表示の配置計算
// ---------------------------------------------------------------------------

/** 配置済みブロック1つ分(top/height は時間軸に対する%) */
export type PlacedBlock = {
  /** 予約・ブロックのID。休憩の擬似ブロックは null */
  id: string | null;
  type: "booking" | "block" | "break";
  topPercent: number;
  heightPercent: number;
  /** 「9:30 佐々木様」「休憩 13:00–13:30」「予約不可 8:00–10:00」 */
  titleLabel: string;
  /** 「カット + カラー(150分)」。60分以下は所要分を省略。予約以外は null */
  menuLabel: string | null;
  /** 「¥11,550」。高さに余裕がある(150分以上)予約のみ。それ以外は null */
  priceLabel: string | null;
};

export type DayColumn = {
  staffId: string;
  /** 「田中(オーナー)」形式の列見出し */
  heading: string;
  blocks: PlacedBlock[];
};

export type DayTimeline = {
  /** 休業日(定休)なら true(時間軸なし・列は空) */
  isClosed: boolean;
  /** 1時間刻みの目盛り(「9:00」〜「19:00」) */
  ticks: string[];
  /** 目盛りの位置付き(グリッド線の描画用。ラベルは ticks と同一) */
  tickMarks: TickMark[];
  /** スタッフ列(入力の staff と同順) */
  columns: DayColumn[];
};

/** スタッフ列の見出し「田中(オーナー)」を組み立てる */
function staffHeading(staff: AdminStaff): string {
  return `${staff.name}(${staff.role === "owner" ? "オーナー" : "スタッフ"})`;
}

/** 予約1件を配置済みブロックにする(時間軸の外なら null) */
function placeBookingItem(
  item: AdminCalendarItem,
  date: string,
  openMinutes: number,
  closeMinutes: number,
): PlacedBlock | null {
  const startMinutes = jstMinutesOfDay(date, item.during.start);
  const endMinutes = jstMinutesOfDay(date, item.during.end);
  const placed = placeOnAxis(
    startMinutes,
    endMinutes,
    openMinutes,
    closeMinutes,
  );
  if (placed === null) return null;

  if (item.kind === "block") {
    return {
      id: item.id,
      type: "block",
      ...placed,
      titleLabel: `予約不可 ${minutesLabel(startMinutes)}–${minutesLabel(endMinutes)}`,
      menuLabel: null,
      priceLabel: null,
    };
  }

  const summary = summarizeSelectedMenus(item.menus);
  const durationMinutes = endMinutes - startMinutes;
  const durationSuffix =
    durationMinutes >= DURATION_LABEL_MIN_MINUTES
      ? `(${summary.totalDurationMinutes}分)`
      : "";
  return {
    id: item.id,
    type: "booking",
    ...placed,
    titleLabel: `${formatJstTime(item.during.start)} ${item.customerName}様`,
    menuLabel: `${menuNamesLabel(item.menus.map((m) => m.menuName))}${durationSuffix}`,
    priceLabel:
      durationMinutes >= PRICE_LABEL_MIN_MINUTES
        ? formatYen(summary.totalPrice)
        : null,
  };
}

/** 勤務パターンの休憩を擬似ブロックにする(休憩なし・時間軸の外なら null) */
function placeBreakBlock(
  working: StaffWorkingDay | undefined,
  openMinutes: number,
  closeMinutes: number,
): PlacedBlock | null {
  if (!working?.breakStart || !working.breakEnd) return null;
  const breakStart = timeToMinutes(working.breakStart);
  const breakEnd = timeToMinutes(working.breakEnd);
  const placed = placeOnAxis(breakStart, breakEnd, openMinutes, closeMinutes);
  if (placed === null) return null;
  return {
    id: null,
    type: "break",
    ...placed,
    // ラベルは勤務パターンの時刻のまま(表示位置だけ営業時間内に切り詰める)
    titleLabel: `休憩 ${minutesLabel(breakStart)}–${minutesLabel(breakEnd)}`,
    menuLabel: null,
    priceLabel: null,
  };
}

/**
 * 日表示(縦=時間軸、横=スタッフ列)の配置を計算する。
 * - 時間軸は営業時間に合わせ、目盛りは1時間刻み
 * - 予約・ブロックはスタッフ列ごとに top%・height% で配置する
 * - 休憩は勤務パターンから擬似ブロックとして生成する
 * - 営業時間の外にはみ出す区間は切り詰め、全く重ならないものは配置しない
 */
export function buildDayTimeline(params: {
  date: string; // JSTの暦日 "YYYY-MM-DD"
  businessDay: BusinessDay; // その曜日の営業時間
  staff: AdminStaff[]; // 表示順(display_order順)
  items: AdminCalendarItem[]; // その日の確定済み予約+ブロック(全スタッフ)
  workingHours: Array<{ staffId: string } & StaffWorkingDay>; // その曜日の勤務パターン
}): DayTimeline {
  const { date, businessDay, staff, items, workingHours } = params;

  if (!businessDay.isOpen || !businessDay.openTime || !businessDay.closeTime) {
    return {
      isClosed: true,
      ticks: [],
      tickMarks: [],
      columns: staff.map((member) => ({
        staffId: member.id,
        heading: staffHeading(member),
        blocks: [],
      })),
    };
  }

  const openMinutes = timeToMinutes(businessDay.openTime);
  const closeMinutes = timeToMinutes(businessDay.closeTime);
  const workingByStaff = new Map(workingHours.map((row) => [row.staffId, row]));

  const columns = staff.map((member) => {
    const blocks: PlacedBlock[] = [];
    for (const item of items) {
      if (item.staffId !== member.id) continue;
      const placed = placeBookingItem(item, date, openMinutes, closeMinutes);
      if (placed !== null) blocks.push(placed);
    }
    const breakBlock = placeBreakBlock(
      workingByStaff.get(member.id),
      openMinutes,
      closeMinutes,
    );
    if (breakBlock !== null) blocks.push(breakBlock);
    blocks.sort((a, b) => a.topPercent - b.topPercent);
    return { staffId: member.id, heading: staffHeading(member), blocks };
  });

  const marks = hourTickMarks(openMinutes, closeMinutes);
  return {
    isClosed: false,
    ticks: marks.map((mark) => mark.label),
    tickMarks: marks,
    columns,
  };
}

// ---------------------------------------------------------------------------
// 2. 週表示への集約
// ---------------------------------------------------------------------------

export type WeekItem = {
  id: string;
  /** 色分け用 */
  staffId: string;
  topPercent: number;
  heightPercent: number;
  /** 「11:00 山田様」 */
  titleLabel: string;
  /** 「カット + カラー」(週表示は所要分なし)。60分以下は null */
  menuLabel: string | null;
};

export type WeekDayColumn = {
  date: string; // "YYYY-MM-DD"
  dayNumber: number; // 13
  weekdayLabel: string; // "日"
  /** 定休日(斜線ハッチング表示)。判定は入力の isClosedDay に従う */
  isClosed: boolean;
  items: WeekItem[];
};

export type WeekView = {
  /** 週内の営業時間の最小開店〜最大閉店に合わせた1時間刻みの目盛り */
  ticks: string[];
  /** 目盛りの位置付き(グリッド線の描画用。ラベルは ticks と同一) */
  tickMarks: TickMark[];
  /** 日曜から7日分 */
  days: WeekDayColumn[];
};

/**
 * 定休日判定(business_hours 由来)。行がない曜日は休業として扱う
 * (booking-data.ts / calendar.ts と同じ判定)。
 */
export function isClosedByBusinessHours(
  date: string,
  businessHours: Array<{ weekday: number; isOpen: boolean }>,
): boolean {
  const weekday = calendarWeekday(date);
  const day = businessHours.find((hours) => hours.weekday === weekday);
  return day?.isOpen !== true;
}

/**
 * 週表示(日曜始まりの7日分)へ予約を集約する。
 * - 週の範囲外の予約・ブロック(kind=block)は載せない
 * - 休業日判定は入力の isClosedDay に従う(将来の第◯曜日・祝日ルールも
 *   同じ入力に載せられる受け口)
 * - 時間軸は週内の営業時間の最小開店〜最大閉店
 */
export function buildWeekView(params: {
  weekStart: string; // 日曜のJST暦日(weekStartOf で求める)
  businessHours: Array<{ weekday: number } & BusinessDay>;
  items: AdminCalendarItem[]; // 7日分の確定済み予約+ブロック
  isClosedDay: (date: string) => boolean;
}): WeekView {
  const { weekStart, businessHours, items, isClosedDay } = params;

  // 週の時間軸 = 営業日の最小開店〜最大閉店
  let openMinutes = Number.POSITIVE_INFINITY;
  let closeMinutes = Number.NEGATIVE_INFINITY;
  for (const day of businessHours) {
    if (!day.isOpen || !day.openTime || !day.closeTime) continue;
    openMinutes = Math.min(openMinutes, timeToMinutes(day.openTime));
    closeMinutes = Math.max(closeMinutes, timeToMinutes(day.closeTime));
  }
  const hasAxis = openMinutes < closeMinutes;

  // 日別にグルーピング(予約のみ。ブロックは週表示に載せない)
  const bookingsByDate = new Map<string, AdminBooking[]>();
  for (const item of items) {
    if (item.kind !== "booking") continue;
    const date = jstCalendarDate(item.during.start);
    const list = bookingsByDate.get(date) ?? [];
    list.push(item);
    bookingsByDate.set(date, list);
  }

  const days: WeekDayColumn[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addCalendarDays(weekStart, i);
    const [, , dayNumber] = date.split("-").map(Number);
    const dayItems: WeekItem[] = [];
    if (hasAxis) {
      for (const item of bookingsByDate.get(date) ?? []) {
        const placed = placeOnAxis(
          jstMinutesOfDay(date, item.during.start),
          jstMinutesOfDay(date, item.during.end),
          openMinutes,
          closeMinutes,
        );
        if (placed === null) continue;
        const summary = summarizeSelectedMenus(item.menus);
        dayItems.push({
          id: item.id,
          staffId: item.staffId,
          ...placed,
          titleLabel: `${formatJstTime(item.during.start)} ${item.customerName}様`,
          menuLabel:
            summary.totalDurationMinutes >= DURATION_LABEL_MIN_MINUTES
              ? menuNamesLabel(item.menus.map((m) => m.menuName))
              : null,
        });
      }
      dayItems.sort((a, b) => a.topPercent - b.topPercent);
    }
    days.push({
      date,
      dayNumber,
      weekdayLabel: WEEKDAY_LABELS[calendarWeekday(date)],
      isClosed: isClosedDay(date),
      items: dayItems,
    });
  }

  const marks = hasAxis ? hourTickMarks(openMinutes, closeMinutes) : [];
  return {
    ticks: marks.map((mark) => mark.label),
    tickMarks: marks,
    days,
  };
}

// ---------------------------------------------------------------------------
// 3. 日付ナビゲーション
// ---------------------------------------------------------------------------

/** 日表示ヘッダーの「2026年7月18日(土)」形式(calendar.ts のラベルに年を足す) */
export function dayNavLabel(date: string): string {
  const [year] = date.split("-").map(Number);
  return `${year}年${calendarDateLabel(date)}`;
}

/** その週の日曜(JST暦日)を返す */
export function weekStartOf(date: string): string {
  return addCalendarDays(date, -calendarWeekday(date));
}

/**
 * 週表示ヘッダーの「2026年7月12日 〜 18日」形式。
 * 終端は同月なら日のみ、月またぎは月から、年またぎは年から表記する。
 */
export function weekNavLabel(weekStart: string): string {
  const weekEnd = addCalendarDays(weekStart, 6);
  const [startYear, startMonth, startDay] = weekStart.split("-").map(Number);
  const [endYear, endMonth, endDay] = weekEnd.split("-").map(Number);

  let endLabel: string;
  if (startYear !== endYear) {
    endLabel = `${endYear}年${endMonth}月${endDay}日`;
  } else if (startMonth !== endMonth) {
    endLabel = `${endMonth}月${endDay}日`;
  } else {
    endLabel = `${endDay}日`;
  }
  return `${startYear}年${startMonth}月${startDay}日 〜 ${endLabel}`;
}

/** 前後の日へ移動する(delta 日) */
export function moveDay(date: string, delta: number): string {
  return addCalendarDays(date, delta);
}

/** 前後の週へ移動する(delta 週) */
export function moveWeek(weekStart: string, delta: number): string {
  return addCalendarDays(weekStart, delta * 7);
}

/** 「今日」チップの判定(JSTの暦日で比較する) */
export function isJstToday(date: string, now: Date): boolean {
  return jstCalendarDate(now) === date;
}

// ---------------------------------------------------------------------------
// 4. 代行登録の空き判定メッセージ
// ---------------------------------------------------------------------------

/**
 * 空き表示の状態。
 * - past: 開始が現在より過去(登録不可。canRegister=false)
 * - available: 対象枠が空いている(登録可)
 * - unavailable: 空き枠ではない(休憩・勤務時間外・他予約と重なり)。
 *   店側は休憩を削って受けられるため、上書き登録は許可(canRegister=true)。
 *   最終判定はDBのEXCLUDE制約(ADR-004)であり、ここは断定しない。
 */
export type SlotAvailabilityStatus = "past" | "available" | "unavailable";

export type SlotAvailability = {
  status: SlotAvailabilityStatus;
  /** このメッセージ状態で登録操作を許すか(過去のみ false) */
  canRegister: boolean;
  message: string;
};

/**
 * 代行登録フォームの空き判定メッセージ(モックD準拠)。
 * slots は対象スタッフの computeStaffDaySlots(availability.ts)の結果。
 * - 開始が現在(now)より厳密に過去なら past(start===now は過去扱いしない)
 * - 対象枠が空いていれば available
 * - それ以外(休憩・勤務時間外・他予約と重なり=slot が無い/taken)は unavailable。
 *   店側の上書き登録を許すため canRegister は true のまま。「埋まっています」と
 *   断定せず、最終判定はDBのEXCLUDE制約(ADR-004)に委ねる。
 */
export function slotAvailabilityMessage(params: {
  slots: Slot[];
  start: Date; // 希望開始時刻(UTC)
  totalDurationMinutes: number; // 選択メニューの合計所要分
  now: Date; // 現在時刻(過去判定の基準。サーバーの now を渡す)
}): SlotAvailability {
  const { slots, start, totalDurationMinutes, now } = params;

  if (start.getTime() < now.getTime()) {
    return {
      status: "past",
      canRegister: false,
      message: "過去の時間は登録できません",
    };
  }

  const slot = slots.find((s) => s.start.getTime() === start.getTime());
  if (slot?.status === "available") {
    return {
      status: "available",
      canRegister: true,
      message: `この枠は空いています。${totalDurationMinutes}分確保できます。`,
    };
  }
  if (slot?.status === "taken") {
    return {
      status: "unavailable",
      canRegister: true,
      message: "この時間は他の予約と重なっています(登録できない場合があります)",
    };
  }
  return {
    status: "unavailable",
    canRegister: true,
    message: "空き枠ではありませんが登録できます(休憩・勤務時間外など)",
  };
}

// ---------------------------------------------------------------------------
// 5. 予約詳細ダイアログ(モックC)の整形
// ---------------------------------------------------------------------------

export type ReservationDetailLabels = {
  /** 「7月18日(土)11:00〜 田中」(日時・担当) */
  dateTimeStaffLabel: string;
  /** 「カット + カラー(150分) ¥11,550」(メニュー名 + 合計所要分 + 合計金額) */
  menuLabel: string;
};

/**
 * 予約詳細ダイアログの「日時・担当」「メニュー」ラベルを組み立てる(モックC準拠)。
 * - 日時・担当: 開始時刻(JST)ラベルにスタッフ名を続ける
 * - メニュー: スナップショットのメニュー名連結 + 合計所要分 + 合計金額
 *   (合計はカレンダーブロックと違い、高さに関係なく常に表示する)
 * 表記は booking.ts の既存フォーマッタに合わせる。
 */
export function buildReservationDetailLabels(params: {
  start: Date;
  staffName: string;
  menus: ReservationMenuSnapshot[];
}): ReservationDetailLabels {
  const { start, staffName, menus } = params;
  const summary = summarizeSelectedMenus(menus);
  const names = menuNamesLabel(menus.map((m) => m.menuName));
  return {
    dateTimeStaffLabel: `${formatJstDateTimeLabel(start)} ${staffName}`,
    menuLabel: `${names}(${summary.totalDurationMinutes}分) ${formatYen(summary.totalPrice)}`,
  };
}

// ---------------------------------------------------------------------------
// 6. 予約リスト表示(スマホ)の整形
// ---------------------------------------------------------------------------

export type ReservationListItem = {
  id: string;
  /** 選択状態などUI側の判定に使う開始時刻(UTC) */
  start: Date;
  /** 「11:00」 */
  timeLabel: string;
  /** 「山田様」 */
  customerLabel: string;
  /** 「カット + カラー / 田中」 */
  menuStaffLabel: string;
  /** 「〜14:00 ・ ¥11,550」(選択中カードの詳細行) */
  endPriceLabel: string;
};

/**
 * スマホ幅の予約リスト表示(モックI)用に予約を整形する。
 * ブロック(kind=block)は除外し、開始時刻順に並べる。
 * 表記は booking.ts / my-reservations.ts の既存フォーマッタに合わせる。
 */
export function buildReservationListItems(
  items: AdminCalendarItem[],
  staff: Array<{ id: string; name: string }>,
): ReservationListItem[] {
  const staffNameById = new Map(staff.map((s) => [s.id, s.name]));
  return items
    .filter((item): item is AdminBooking => item.kind === "booking")
    .sort((a, b) => a.during.start.getTime() - b.during.start.getTime())
    .map((item) => {
      const summary = summarizeSelectedMenus(item.menus);
      const menuNames = menuNamesLabel(item.menus.map((m) => m.menuName));
      return {
        id: item.id,
        start: item.during.start,
        timeLabel: formatJstTime(item.during.start),
        customerLabel: `${item.customerName}様`,
        menuStaffLabel: `${menuNames} / ${staffNameById.get(item.staffId) ?? ""}`,
        endPriceLabel: `〜${formatJstTime(item.during.end)} ・ ${formatYen(summary.totalPrice)}`,
      };
    });
}
