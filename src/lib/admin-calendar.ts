// 管理画面の予約カレンダー(M4)の判断ロジック(純粋関数)。
// 日表示の配置計算・週表示への集約・日付ナビゲーション・
// 代行登録の空き判定メッセージ・予約リスト表示(スマホ)の整形を扱う。
// 日時の前提は availability.ts / booking.ts と同じ(JST = UTC+9 固定)。
// 日表示はスタッフごとに列が分かれ、同一スタッフの重複はEXCLUDE制約(ADR-004)で
// 起きないため、重なり回避レイアウトは行わない。週表示は1つの日付列に全スタッフの
// 予約を並べるため、別スタッフ同士が重なる。こちらはレーン分割で横に並べる。

import {
  addCalendarDays,
  calendarWeekday,
  isCalendarDate,
  isWithinBookingWindow,
  jstCalendarDate,
  jstClockTime,
  jstDateTime,
  type BookingPolicy,
  type BusinessDay,
  type BusyRange,
  type SlotStatus,
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

// 表示しきい値。カードの高さ(=所要分)に何行入るかで決める。
// 時間軸は1時間 = 4rem = 64px(timeline-column.tsx の timelineHeight)なので、
// 所要分 n の予約カードの高さは概ね n / 60 * 64px。
//
// - 所要分「(150分)」: 1行目 text-sm(~20px)+ 2行目 text-xs(~16px)+
//   上下padding py-1.5(12px)= 約48px で、60分(64px)でも2行は収まる。
//   ここは高さではなくモック準拠の見た目(1コマの短い予約はメニュー名だけ)で
//   60分以下を省略しており、実機で問題が出ていないため現状維持とする。
// - 料金(3行目): 上の2行に 3行目 text-xs + mt-1(~20px)を足して約68px。
//   60分(64px)では収まらないが、70分(約75px)以上なら収まる。
//   以前は 150 にしていたが「90分だと料金が出ない」ため、収まる下限まで下げる。
const DURATION_LABEL_MIN_MINUTES = 61;
const PRICE_LABEL_MIN_MINUTES = 70;

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

/**
 * 時間軸上の帯1本(top%/height% の基準は PlacedBlock と同じ軸)。
 * 文字を持たない装飾の下地なので、ラベル類を持つ PlacedBlock とは分ける。
 */
export type PlacedBand = {
  topPercent: number;
  heightPercent: number;
};

/**
 * 軸([open, close])のうち、その日の営業時間から外れる領域を帯にする。
 *
 * 週表示の軸は「週内の全曜日の最小開店〜最大閉店」で作るため、他の曜日より
 * 早く閉まる・遅く開く曜日には、その日は営業していない領域が軸の中に現れる
 * (例: 他の曜日は19時閉店・水曜だけ21時閉店 → 月曜の 19:00〜21:00)。
 * 目印が無いとただの空き領域に見え、クリックで代行登録まで開けてしまうため、
 * 「その日は営業時間外」と分かる下地を敷くための位置をここで決める。
 * 軸を狭めて隠すことはしない(水曜の 19:00〜21:00 の予約が消えるため)。
 *
 * - 帯は最大2本(開店前・閉店後)。軸と営業時間が一致する日は空配列
 * - 定休日(isClosed)は列全体が定休日の表現(下地+「定休日」ラベル)になるため
 *   帯を出さない。重ねて塗ると濃さが変わり、「その日は開かない(定休日)」と
 *   「その日は営業しているが時間外」の区別が付かなくなる。is_open=false の曜日・
 *   営業時間の行が無い曜日も同じ扱い(= その日は開かない)
 * - 予約で軸が広がった場合も基準は軸なので、帯は広がった分まで自動で伸びる
 *   (その帯の上に予約が描かれるのは想定どおり)
 */
export function offHoursBands(params: {
  axis: TimelineAxis;
  /** その日の営業時間(週表示は business_hours のその曜日の行) */
  businessDay: BusinessDay;
  /** 休業日ルール込みの定休判定(WeekDayColumn.isClosed と同じ値) */
  isClosed: boolean;
}): PlacedBand[] {
  const { axis, businessDay, isClosed } = params;
  if (
    isClosed ||
    !businessDay.isOpen ||
    !businessDay.openTime ||
    !businessDay.closeTime
  ) {
    return [];
  }
  const { openMinutes, closeMinutes } = axis;
  const open = timeToMinutes(businessDay.openTime);
  const close = timeToMinutes(businessDay.closeTime);
  const bands: PlacedBand[] = [];
  // 開店前(軸の上端〜その日の開店)
  const before = placeOnAxis(openMinutes, open, openMinutes, closeMinutes);
  if (before !== null) bands.push(before);
  // 閉店後(その日の閉店〜軸の下端)
  const after = placeOnAxis(close, closeMinutes, openMinutes, closeMinutes);
  if (after !== null) bands.push(after);
  return bands;
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
  /** 「¥11,550」。3行が収まる高さ(70分以上)の予約のみ。それ以外は null */
  priceLabel: string | null;
};

export type DayColumn = {
  staffId: string;
  /** 「田中(オーナー)」形式の列見出し */
  heading: string;
  blocks: PlacedBlock[];
};

/** 時間軸の範囲(0時からの分数)。top%/height% の基準そのもの */
export type TimelineAxis = {
  openMinutes: number;
  closeMinutes: number;
};

export type DayTimeline = {
  /**
   * 休業日(定休)なら true。UIの定休日バッジ判断に使う。
   * 予約のない休業日は時間軸なし・列は空だが、予約があれば isClosed:true の
   * まま予約の範囲で軸・列を組む(定休日の既存予約を隠さない)。
   */
  isClosed: boolean;
  /**
   * 時間軸の範囲(分数)。top%/height% の基準であり、UIが列内のクリック位置
   * (0〜1の比率)を時刻へ戻すのに使う(timeFromTimelineRatio)。
   * 予約のない休業日はタイムライン自体を描かないため null。
   */
  axis: TimelineAxis | null;
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

/**
 * 休業日でも既存予約を隠さないための時間軸を items から決める。
 * - openMinutes = 最も早い開始を時(正時)で切り下げ
 * - closeMinutes = 最も遅い終了を時(正時)で切り上げ(最低1時間確保)
 * items が空(=予約なしの休業日)なら null(UIは「定休日です。」)。
 */
function itemsAxis(
  items: AdminCalendarItem[],
  date: string,
): { openMinutes: number; closeMinutes: number } | null {
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    minStart = Math.min(minStart, jstMinutesOfDay(date, item.during.start));
    maxEnd = Math.max(maxEnd, jstMinutesOfDay(date, item.during.end));
  }
  if (minStart >= maxEnd) return null; // items が空(または長さ0のみ)
  const openMinutes = Math.floor(minStart / 60) * 60;
  const closeMinutes = Math.max(
    Math.ceil(maxEnd / 60) * 60,
    openMinutes + 60, // 最低1時間の軸を確保する
  );
  return { openMinutes, closeMinutes };
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
 * - 休業日(定休)でも予約が1件でもあれば、予約の時間範囲から軸を組んで
 *   予約・ブロックを表示する(店側が過去・別経路の予約を確認・取り消せるように)。
 *   その場合も isClosed は true のまま返す(UIが定休日バッジを出す判断に使う)。
 *   予約のない休業日は従来どおり isClosed:true・目盛り空で返す。
 *
 * 週表示の offHoursBands(営業時間外の帯)に相当するものは日表示には置かない:
 * - 営業日の軸はその日の営業時間そのもの(列は全スタッフ共通で1日分)なので、
 *   軸と営業時間がずれる余地がなく、帯は必ず空になる
 * - 軸が営業時間から外れるのは休業日(itemsAxis)のときだけで、その日は
 *   丸ごと営業時間外。週表示が定休日に帯を重ねないのと同じ理由で、帯ではなく
 *   定休日バッジ(ClosedDayBanner)で示す
 * 「定休日は列の表現・それ以外のずれは帯」という理屈は日/週で揃っている。
 */
export function buildDayTimeline(params: {
  date: string; // JSTの暦日 "YYYY-MM-DD"
  businessDay: BusinessDay; // その曜日の営業時間
  staff: AdminStaff[]; // 表示順(display_order順)
  items: AdminCalendarItem[]; // その日の確定済み予約+ブロック(全スタッフ)
  workingHours: Array<{ staffId: string } & StaffWorkingDay>; // その曜日の勤務パターン
}): DayTimeline {
  const { date, businessDay, staff, items, workingHours } = params;

  const isClosed =
    !businessDay.isOpen || !businessDay.openTime || !businessDay.closeTime;

  // 時間軸([open, close] 分数)を決める。
  // - 営業日: 営業時間
  // - 休業日でも予約があれば予約の時間範囲から組む(定休日の予約を隠さない)
  const axis =
    !isClosed && businessDay.openTime && businessDay.closeTime
      ? {
          openMinutes: timeToMinutes(businessDay.openTime),
          closeMinutes: timeToMinutes(businessDay.closeTime),
        }
      : itemsAxis(items, date);

  // 予約のない休業日は目盛りなし・列は空(UIは「定休日です。」)
  if (axis === null) {
    return {
      isClosed: true,
      axis: null,
      ticks: [],
      tickMarks: [],
      columns: staff.map((member) => ({
        staffId: member.id,
        heading: staffHeading(member),
        blocks: [],
      })),
    };
  }

  const { openMinutes, closeMinutes } = axis;
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
    isClosed,
    axis: { openMinutes, closeMinutes },
    ticks: marks.map((mark) => mark.label),
    tickMarks: marks,
    columns,
  };
}

/**
 * 日表示のスタッフ列でクリックされた位置(列内の縦比率)を、代行登録の
 * 開始時刻 "HH:MM"(ゼロ埋め。<input type="time"> にそのまま入る形式)にする。
 * - ratio は 0〜1(列の上端=0・下端=1)。範囲外はクランプする
 * - 刻みは店舗設定(salon_settings.slot_interval_minutes)に従い、
 *   開店時刻を基準に切り下げる(availability.ts の空き枠と同じ基準。ADR-007の
 *   とおり30分などの値をここに書かない)
 * - 切り下げるため結果が closeMinutes を超えることはない
 */
export function timeFromTimelineRatio(params: {
  ratio: number;
  openMinutes: number;
  closeMinutes: number;
  intervalMinutes: number;
}): string {
  const { openMinutes, closeMinutes } = params;
  // 刻みが不正(0以下)でも落ちないよう1分刻みに倒す
  const interval = params.intervalMinutes > 0 ? params.intervalMinutes : 1;
  const total = closeMinutes - openMinutes;
  const ratio = Math.min(Math.max(params.ratio, 0), 1);
  // 軸の長さが0以下(0除算・逆転)なら開店時刻に倒す
  const offset =
    total > 0 ? Math.floor((ratio * total) / interval) * interval : 0;
  const minutes = openMinutes + offset;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

/**
 * フローティングダイアログの位置をビューポート内に留める(ドラッグ・リサイズ用)。
 * 上下左右に margin を残す。ダイアログがビューポートより大きい場合は
 * 上端・左端(margin の位置)を優先し、右下がはみ出したままでも破綻させない
 * (パネル内スクロールで中身は読める)。
 */
export function clampDialogPosition(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  margin: number;
}): { x: number; y: number } {
  const { x, y, width, height, viewportWidth, viewportHeight, margin } = params;
  const maxX = Math.max(margin, viewportWidth - width - margin);
  const maxY = Math.max(margin, viewportHeight - height - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}

/**
 * クリックした列と、その列が属する列グリッド全体の左右X(ビューポート座標のpx)。
 * 空き枠クリック(代行登録)でも予約カードのクリック(変更)でも、押した要素から
 * 同じ形で計測して渡す。DOM計測はUI層の責務で、位置の判断はここの純粋関数が持つ。
 */
export type ColumnAnchor = {
  columnLeft: number;
  columnRight: number;
  gridLeft: number;
  gridRight: number;
};

/**
 * フォームダイアログ(代行登録・変更で共通)の初期X座標(px)。
 * - 押した列が分かるとき(anchor あり)は dialogInitialX と同じ位置ロジック
 *   = 押した列以外の広い領域の中央。代行登録も変更も同じ体験にする
 * - 押した列が分からないとき(anchor なし。スマホのリスト表示から詳細→変更など)は
 *   右端に寄せて左端の時間目盛りと左側の列を残す(dialogInitialX が残り領域
 *   同幅のときに右側を選ぶのと同じ方針)
 */
export function formDialogInitialX(params: {
  anchor: ColumnAnchor | null;
  viewportWidth: number;
  dialogWidth: number;
  margin: number;
}): number {
  const { anchor, viewportWidth, dialogWidth, margin } = params;
  if (anchor !== null) {
    return dialogInitialX({
      clickedColumnLeft: anchor.columnLeft,
      clickedColumnRight: anchor.columnRight,
      gridLeft: anchor.gridLeft,
      gridRight: anchor.gridRight,
      viewportWidth,
      dialogWidth,
      margin,
    });
  }
  // 画面がダイアログより狭ければ左余白に倒す(clampDialogPosition と同じ扱い)
  return Math.max(margin, viewportWidth - dialogWidth - margin);
}

/**
 * 代行登録ダイアログの初期X座標(px)。クリックしたスタッフ列「以外」の領域の
 * 中央にダイアログを重ねる。非モーダルで「背後のカレンダーを見ながら入力する」
 * ダイアログなので、いま押した列の空き状況が隠れると目的を果たせない。
 * 画面端に寄せるのではなく他の列に重ねることで、押した列が中途半端に隠れず、
 * 2人ならもう一方の列の真ん中に出る(実機フィードバック)。
 * - クリック列の右側に残る領域の幅 = gridRight - clickedColumnRight、
 *   左側に残る領域の幅 = clickedColumnLeft - gridLeft
 * - 広い方の領域を選び、その中央にダイアログの中心を合わせる
 * - 同幅なら右側(左端の時間目盛りを隠さない側。従来の方針を踏襲)
 * - 最後にビューポート内へクランプする(左右に margin を残す。反対側の領域が
 *   ダイアログより狭い場合・スタッフ1人で反対側が無い場合もここで収まる)
 * - 画面がダイアログより狭い場合は左余白に倒す(clampDialogPosition と同じ扱い)
 */
export function dialogInitialX(params: {
  /** クリックした列の左右X(ビューポート座標のpx) */
  clickedColumnLeft: number;
  clickedColumnRight: number;
  /** スタッフ列グリッド全体の左右X(ビューポート座標のpx) */
  gridLeft: number;
  gridRight: number;
  viewportWidth: number;
  dialogWidth: number;
  margin: number;
}): number {
  const {
    clickedColumnLeft,
    clickedColumnRight,
    gridLeft,
    gridRight,
    viewportWidth,
    dialogWidth,
    margin,
  } = params;

  // 残り領域の幅。計測値が壊れていても負にしない(0 = 反対側が無い扱い)
  const rightWidth = Math.max(0, gridRight - clickedColumnRight);
  const leftWidth = Math.max(0, clickedColumnLeft - gridLeft);

  // 広い方の領域の中央。同幅(両方0=スタッフ1人を含む)なら右側
  const areaCenter =
    rightWidth >= leftWidth
      ? (clickedColumnRight + gridRight) / 2
      : (gridLeft + clickedColumnLeft) / 2;

  const x = areaCenter - dialogWidth / 2;
  const maxX = Math.max(margin, viewportWidth - dialogWidth - margin);
  return Math.min(Math.max(x, margin), maxX);
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
  /**
   * ツールチップ用の全メニュー名「カット + カラー」。カードの高さで省略する
   * menuLabel と違い、常に全メニューを持つ(幅が狭くて文字が切れても
   * title 属性で内容が分かるようにするため)。
   */
  menuNames: string;
  /** 重なり時の横位置(%)。重なりが無ければ 0 */
  leftPercent: number;
  /** 重なり時の横幅(%)。重なりが無ければ 100 */
  widthPercent: number;
};

/**
 * 週表示カードのツールチップ文字列。
 * 「11:00 山田様 / カット + カラー / 田中」。
 * 空の要素(メニューなし・担当名が引けない)は区切りごと落とす。
 */
export function weekItemTooltip(
  item: { titleLabel: string; menuNames: string },
  staffName: string | undefined | null,
): string {
  return [item.titleLabel, item.menuNames, staffName ?? ""]
    .filter((part) => part !== "")
    .join(" / ");
}

/**
 * 同じ日に重なる区間を横に並べるためのレーン分割(標準的なカレンダーの方式)。
 * - 開始時刻順(同時刻なら終了が早い順、それも同じなら入力順)に並べる
 * - 連鎖的に重なるアイテムの集まり(クラスタ)を求める
 * - 各アイテムを「最後のアイテムが自分の開始以前に終わっている最初のレーン」へ入れる
 *   (空いたレーンは再利用する。A-B と B-C が重なり A-C が重ならない連鎖なら
 *   C は A のレーンに入り、クラスタのレーン数は2になる)
 * - クラスタ内は同じレーン数で幅を等分する(2件なら各50%、3件なら各33.33%)
 * 重なり判定は半開区間 [開始, 終了)。接している(前の終了 == 次の開始)は
 * 重なりではない(EXCLUDE制約と同じ扱い)。
 *
 * 入力の順序は壊さず、入力と同じ添字で {leftPercent, widthPercent} を返す。
 */
function assignOverlapLanes(
  ranges: Array<{ startMs: number; endMs: number }>,
): Array<{ leftPercent: number; widthPercent: number }> {
  const order = ranges
    .map((range, index) => ({ ...range, index }))
    .sort(
      (a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.index - b.index,
    );

  const result = ranges.map(() => ({ leftPercent: 0, widthPercent: 100 }));

  // クラスタ内の状態: レーンごとの「最後のアイテムの終了時刻」と、
  // 幅を確定させるためにクラスタのメンバー(添字とレーン)を溜める。
  let laneEnds: number[] = [];
  let cluster: Array<{ index: number; lane: number }> = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (cluster.length === 0) return;
    const width = 100 / laneEnds.length;
    for (const member of cluster) {
      result[member.index] = {
        leftPercent: member.lane * width,
        widthPercent: width,
      };
    }
    laneEnds = [];
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const range of order) {
    // クラスタ内の誰とも重ならない(全員が自分の開始までに終わっている)なら
    // そこでクラスタを切る
    if (range.startMs >= clusterEnd) flush();

    let lane = laneEnds.findIndex((end) => end <= range.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(range.endMs);
    } else {
      laneEnds[lane] = range.endMs;
    }
    cluster.push({ index: range.index, lane });
    clusterEnd = Math.max(clusterEnd, range.endMs);
  }
  flush();

  return result;
}

export type WeekDayColumn = {
  date: string; // "YYYY-MM-DD"
  dayNumber: number; // 13
  weekdayLabel: string; // "日"
  /** 定休日(背景色で区別して表示)。判定は入力の isClosedDay に従う */
  isClosed: boolean;
  /**
   * その日の営業時間外にあたる領域(軸基準の top%/height%。最大2本)。
   * 軸は週内の最小開店〜最大閉店なので、他の曜日より早く閉まる・遅く開く日には
   * 営業していない領域が軸の中に残る。そこを淡い下地で示すための位置。
   * 定休日(isClosed)は列全体が定休日の表現になるため空配列(offHoursBands)。
   */
  offHoursBands: PlacedBand[];
  items: WeekItem[];
};

export type WeekView = {
  /**
   * 時間軸の範囲(分数)。top%/height% の基準であり、UIが日付列内のクリック位置
   * (0〜1の比率)を時刻へ戻すのに使う(timeFromTimelineRatio)。
   * 週内に営業日も予約もなければタイムライン自体を描かないため null。
   * 形は DayTimeline.axis と同じ(日/週で同じ配線が使える)。
   */
  axis: TimelineAxis | null;
  /** 週内の営業時間の最小開店〜最大閉店に合わせた1時間刻みの目盛り */
  ticks: string[];
  /** 目盛りの位置付き(グリッド線の描画用。ラベルは ticks と同一) */
  tickMarks: TickMark[];
  /** 日曜から7日分 */
  days: WeekDayColumn[];
};

/**
 * 週表示(日曜始まりの7日分)へ予約を集約する。
 * - 週の範囲外の予約・ブロック(kind=block)は載せない
 * - 休業日判定は入力の isClosedDay に従う(closures.ts の makeIsClosedDay を
 *   渡す。毎週の定休・第◯曜日・祝日・臨時休業が同じ受け口に載る)
 * - 時間軸は週内の営業時間の最小開店〜最大閉店
 * - 軸と日ごとの営業時間のずれ(他の曜日より早く閉まる日の閉店後など)は
 *   日付列ごとに offHoursBands で返す(UIが淡い下地を敷く)。軸そのものは
 *   狭めない(遅くまで開く曜日の予約が軸の外に消えるため)
 * - 1日だけの臨時営業(date_overrides の open_time/close_time)では軸は広がらない。
 *   軸は予約の開始・終了でも広がるため実害が小さく、対応は見送っている
 *   (営業時間外の帯も同じく business_hours のその曜日の行だけを見る)
 */
export function buildWeekView(params: {
  weekStart: string; // 日曜のJST暦日(weekStartOf で求める)
  businessHours: Array<{ weekday: number } & BusinessDay>;
  items: AdminCalendarItem[]; // 7日分の確定済み予約+ブロック
  isClosedDay: (date: string) => boolean;
}): WeekView {
  const { weekStart, businessHours, items, isClosedDay } = params;

  // 週の7日分の暦日(範囲外の予約を軸・配置から除くための集合)
  const weekDates = new Set<string>();
  for (let i = 0; i < 7; i++) weekDates.add(addCalendarDays(weekStart, i));

  // 日別にグルーピング(予約のみ。ブロックは週表示に載せない。範囲外も除く)
  const bookingsByDate = new Map<string, AdminBooking[]>();
  for (const item of items) {
    if (item.kind !== "booking") continue;
    const date = jstCalendarDate(item.during.start);
    if (!weekDates.has(date)) continue;
    const list = bookingsByDate.get(date) ?? [];
    list.push(item);
    bookingsByDate.set(date, list);
  }

  // 週の時間軸 = 営業日の最小開店〜最大閉店に、予約の開始・終了も含める。
  // (定休日・営業時間外の予約が軸から外れて消えないようにする)
  let openMinutes = Number.POSITIVE_INFINITY;
  let closeMinutes = Number.NEGATIVE_INFINITY;
  for (const day of businessHours) {
    if (!day.isOpen || !day.openTime || !day.closeTime) continue;
    openMinutes = Math.min(openMinutes, timeToMinutes(day.openTime));
    closeMinutes = Math.max(closeMinutes, timeToMinutes(day.closeTime));
  }
  // 予約で軸を広げるときは正時に丸める(日表示の itemsAxis と同じ扱い)。
  // 丸めないと 9:15 開始の予約1件で軸が 9:15 始まりになり、クリック位置から
  // 求まる時刻(timeFromTimelineRatio は開店基準で刻む)が空き枠の格子から
  // 常にずれてしまう。営業時間そのものは丸めない(正時でない店舗もあるため。
  // hourTickMarks が開店位置より下から目盛りを打つ既存の挙動に合わせる)。
  let itemsOpenMinutes = Number.POSITIVE_INFINITY;
  let itemsCloseMinutes = Number.NEGATIVE_INFINITY;
  for (const [date, list] of bookingsByDate) {
    for (const item of list) {
      itemsOpenMinutes = Math.min(
        itemsOpenMinutes,
        jstMinutesOfDay(date, item.during.start),
      );
      itemsCloseMinutes = Math.max(
        itemsCloseMinutes,
        jstMinutesOfDay(date, item.during.end),
      );
    }
  }
  if (itemsOpenMinutes < itemsCloseMinutes) {
    openMinutes = Math.min(openMinutes, Math.floor(itemsOpenMinutes / 60) * 60);
    closeMinutes = Math.max(
      closeMinutes,
      Math.ceil(itemsCloseMinutes / 60) * 60,
    );
  }
  const hasAxis = openMinutes < closeMinutes;

  // 曜日 → その曜日の営業時間(営業時間外の帯を日ごとに出すために引く)。
  // 行が無い曜日は休業扱い(closures.ts の呼び出し側と同じ既定)
  const businessDayByWeekday = new Map(
    businessHours.map((day) => [day.weekday, day]),
  );
  const closedDay: BusinessDay = {
    isOpen: false,
    openTime: null,
    closeTime: null,
  };

  const days: WeekDayColumn[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addCalendarDays(weekStart, i);
    const [, , dayNumber] = date.split("-").map(Number);
    let dayItems: WeekItem[] = [];
    if (hasAxis) {
      // 軸に載る予約だけを先に確定させ、その並びでレーン分割する。
      // 重なり判定は %(浮動小数)ではなく元の during(ミリ秒)で行う。
      const placedBookings: Array<{
        item: AdminBooking;
        placed: { topPercent: number; heightPercent: number };
      }> = [];
      for (const item of bookingsByDate.get(date) ?? []) {
        const placed = placeOnAxis(
          jstMinutesOfDay(date, item.during.start),
          jstMinutesOfDay(date, item.during.end),
          openMinutes,
          closeMinutes,
        );
        if (placed === null) continue;
        placedBookings.push({ item, placed });
      }

      const lanes = assignOverlapLanes(
        placedBookings.map(({ item }) => ({
          startMs: item.during.start.getTime(),
          endMs: item.during.end.getTime(),
        })),
      );

      dayItems = placedBookings.map(({ item, placed }, index) => {
        const summary = summarizeSelectedMenus(item.menus);
        const names = menuNamesLabel(item.menus.map((m) => m.menuName));
        return {
          id: item.id,
          staffId: item.staffId,
          ...placed,
          ...lanes[index],
          titleLabel: `${formatJstTime(item.during.start)} ${item.customerName}様`,
          menuLabel:
            summary.totalDurationMinutes >= DURATION_LABEL_MIN_MINUTES
              ? names
              : null,
          menuNames: names,
        };
      });
      dayItems.sort(
        (a, b) => a.topPercent - b.topPercent || a.leftPercent - b.leftPercent,
      );
    }
    const isClosed = isClosedDay(date);
    days.push({
      date,
      dayNumber,
      weekdayLabel: weekdayLabel(date),
      isClosed,
      offHoursBands: hasAxis
        ? offHoursBands({
            axis: { openMinutes, closeMinutes },
            businessDay:
              businessDayByWeekday.get(calendarWeekday(date)) ?? closedDay,
            isClosed,
          })
        : [],
      items: dayItems,
    });
  }

  const marks = hasAxis ? hourTickMarks(openMinutes, closeMinutes) : [];
  return {
    axis: hasAxis ? { openMinutes, closeMinutes } : null,
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

/**
 * 曜日ラベル「土」を返す。ネイティブの <input type="date"> は曜日を表示しないため、
 * ヘッダーの日付ピッカーに添える(定休日の判断に曜日が要る)。
 */
export function weekdayLabel(date: string): string {
  return WEEKDAY_LABELS[calendarWeekday(date)];
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

/**
 * 登録・変更ダイアログのフォームで日付が変わったとき、背後のカレンダーを
 * その日付へ動かすべきかを判定する(非モーダルなので背後を見ながら操作する)。
 * 動かさなくてよいのは「すでに見えている」場合:
 * - 日表示: 同じ日付を表示している
 * - 週表示: 同じ週(日曜始まり)を表示している = その日付の列がすでに見えている
 * <input type="date"> は入力途中に空文字・不完全な値になるため、不正な日付では
 * 追従しない。表示中の日付が不正な場合は、正しい日付へ動かす。
 */
export function shouldFollowDate(params: {
  view: "day" | "week";
  /** 背後のカレンダーが表示中のJST暦日 */
  currentDate: string;
  /** フォームで選ばれたJST暦日 */
  nextDate: string;
}): boolean {
  const { view, currentDate, nextDate } = params;
  if (!isCalendarDate(nextDate)) return false;
  if (!isCalendarDate(currentDate)) return true;
  return view === "day"
    ? nextDate !== currentDate
    : weekStartOf(nextDate) !== weekStartOf(currentDate);
}

// ---------------------------------------------------------------------------
// 4. 代行登録の空き判定メッセージ
// ---------------------------------------------------------------------------

/**
 * 空き表示の状態。
 * - past: 開始が現在より過去(登録不可。canRegister=false)
 * - closed: 対象日が定休日(登録不可。canRegister=false)。休憩・勤務時間外の
 *   上書きは許すが、定休日だけは登録をブロックする(2026-07-18決定)
 * - available: 対象枠が空いている(登録可)
 * - unavailable: 空き枠ではない(休憩・勤務時間外・他予約と重なり)。
 *   店側は休憩を削って受けられるため、上書き登録は許可(canRegister=true)。
 *   最終判定はDBのEXCLUDE制約(ADR-004)であり、ここは断定しない。
 */
export type SlotAvailabilityStatus =
  "past" | "closed" | "available" | "unavailable";

/**
 * 空き枠が生成されなかった理由。computeStaffDaySlots(availability.ts)が
 * 候補から外す条件と1対1で対応する(同じ順序・同じ境界で判定する)。
 * - past / closed: 登録不可(status も同名)
 * - no_working_day: その日の勤務パターンが無い(週の勤務外)
 * - outside_booking_window: 受付期間(booking_window_days)の外
 * - too_soon: 直前締切(min_lead_minutes)を過ぎている
 * - duration_not_fit: 閉店までに所要時間が収まらない
 * - during_break: 勤務パターンの休憩と重なる
 * - outside_working_hours: 勤務区間(営業時間 ∩ 勤務時間)に収まらない
 * - overlaps_reservation: 既存の予約・ブロックと重なる
 * - off_grid: 上のどれでもないが、開始時刻が枠の刻みに乗っていない
 */
export type SlotUnavailableReason =
  | "past"
  | "closed"
  | "no_working_day"
  | "outside_booking_window"
  | "too_soon"
  | "duration_not_fit"
  | "outside_working_hours"
  | "during_break"
  | "overlaps_reservation"
  | "off_grid";

export type SlotAvailability = {
  status: SlotAvailabilityStatus;
  /** 空き枠でない理由(available では付かない)。UIの色分けには使わない */
  reason?: SlotUnavailableReason;
  /** このメッセージ状態で登録操作を許すか(past / closed のみ false) */
  canRegister: boolean;
  message: string;
};

/** 上書き登録は許す状態(past / closed 以外)の組み立て */
function unavailable(
  reason: SlotUnavailableReason,
  message: string,
): SlotAvailability {
  return { status: "unavailable", reason, canRegister: true, message };
}

/**
 * 代行登録フォームの空き判定メッセージ(モックD準拠)。
 * 「空き枠ではありません」で終わらせず、枠が生成されなかった理由まで返す
 * (実機フィードバック: 勤務が無いのか・休憩なのか・予約が入っているのかを
 * 区別できず、店側が「予約が入っているのか?」と誤解した)。
 *
 * 判定順・境界は computeStaffDaySlots(availability.ts)の除外条件と揃える:
 * past → closed → 勤務なし → 受付期間 → 直前締切 → 閉店に収まるか →
 * 休憩 → 勤務区間 → 既存予約との重なり(半開区間)→ 刻み → 空き。
 *
 * 登録可否は past / closed のみ false。休憩・勤務時間外・他予約との重なりは
 * 店側が事情を知って上書きできるため canRegister は true のままにし、
 * 最終判定はDBのEXCLUDE制約(ADR-004)に委ねる。
 *
 * メッセージ中の時刻・分数・日数はすべて引数(DB由来の営業時間・勤務時間・
 * salon_settings のポリシー)を差し込む(ADR-007: 店舗固有値を書かない)。
 */
export function describeSlotAvailability(params: {
  start: Date; // 希望開始時刻(UTC)
  durationMinutes: number; // 選択メニューの合計所要分
  businessDay: BusinessDay; // その曜日の営業時間
  isClosedDay: boolean; // 休業日ルール(定休日・臨時休業)
  working: StaffWorkingDay | null; // 対象スタッフのその曜日の勤務パターン
  busy: BusyRange[]; // 対象スタッフの確定済み予約・ブロック
  policy: BookingPolicy;
  now: Date; // 現在時刻(過去・直前締切の基準。サーバーの now を渡す)
  staffName?: string; // 分かるならメッセージに入れる(「田中さんは…」)
}): SlotAvailability {
  const {
    start,
    durationMinutes,
    businessDay,
    isClosedDay,
    working,
    busy,
    policy,
    now,
    staffName,
  } = params;

  // 1. 過去(start === now は過去扱いしない)。定休日より優先する
  if (start.getTime() < now.getTime()) {
    return {
      status: "past",
      reason: "past",
      canRegister: false,
      message: "過去の時間は登録できません",
    };
  }

  // 2. 定休日(computeStaffDaySlots の最初の除外条件と同じ)
  if (
    isClosedDay ||
    !businessDay.isOpen ||
    !businessDay.openTime ||
    !businessDay.closeTime
  ) {
    return {
      status: "closed",
      reason: "closed",
      canRegister: false,
      message: "定休日は登録できません",
    };
  }

  // 3. その日の勤務パターンが無い(週の勤務外)
  if (working === null) {
    return unavailable(
      "no_working_day",
      staffName !== undefined && staffName !== ""
        ? `${staffName}さんはこの日の勤務がありません`
        : "この日は勤務がありません",
    );
  }

  const date = jstCalendarDate(start);

  // 4. 受付期間外
  if (!isWithinBookingWindow(date, policy, now)) {
    return unavailable(
      "outside_booking_window",
      `受付期間(${policy.bookingWindowDays}日先まで)を超えています`,
    );
  }

  // 5. 直前締切(start < now + min_lead_minutes)
  if (start.getTime() < now.getTime() + policy.minLeadMinutes * MINUTE_MS) {
    return unavailable(
      "too_soon",
      `直前すぎます(${policy.minLeadMinutes}分前までに受付)`,
    );
  }

  const open = timeToMinutes(businessDay.openTime);
  const close = timeToMinutes(businessDay.closeTime);
  const startMinutes = jstMinutesOfDay(date, start);
  const endMinutes = startMinutes + durationMinutes;

  // 6. 閉店までに所要時間が収まらない(ループ条件 t + duration <= close と同じ)
  if (endMinutes > close) {
    return unavailable(
      "duration_not_fit",
      `${minutesLabel(close)}の閉店までに${durationMinutes}分は確保できません`,
    );
  }

  // 勤務区間 = 営業時間 ∩ 勤務時間(computeStaffDaySlots と同じ切り詰め)
  const workStart = Math.max(open, timeToMinutes(working.startTime));
  const workEnd = Math.min(close, timeToMinutes(working.endTime));

  // 7. 休憩と重なる(半開区間 [開始, 終了)。勤務時間外より優先する)
  if (working.breakStart !== null && working.breakEnd !== null) {
    const breakStart = timeToMinutes(working.breakStart);
    const breakEnd = timeToMinutes(working.breakEnd);
    if (startMinutes < breakEnd && breakStart < endMinutes) {
      return unavailable(
        "during_break",
        `休憩時間です(${minutesLabel(breakStart)}〜${minutesLabel(breakEnd)})`,
      );
    }
  }

  // 8. 勤務区間に収まらない
  if (startMinutes < workStart || endMinutes > workEnd) {
    return unavailable(
      "outside_working_hours",
      `勤務時間外です(${minutesLabel(workStart)}〜${minutesLabel(workEnd)})`,
    );
  }

  // 9. 既存の予約・ブロックと重なる(半開区間。EXCLUDE制約と同じ扱い)
  const end = new Date(start.getTime() + durationMinutes * MINUTE_MS);
  if (busy.some((range) => start < range.end && range.start < end)) {
    return unavailable(
      "overlaps_reservation",
      "この時間は他の予約と重なっています",
    );
  }

  // 10. 刻みに乗っていない(候補は開店時刻を基準に slot_interval_minutes 刻み)
  const interval =
    policy.slotIntervalMinutes > 0 ? policy.slotIntervalMinutes : 1;
  if ((startMinutes - open) % interval !== 0) {
    return unavailable(
      "off_grid",
      `開始時刻が${interval}分刻みに合っていません`,
    );
  }

  return {
    status: "available",
    canRegister: true,
    message: `この枠は空いています。${durationMinutes}分確保できます。`,
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

// ---------------------------------------------------------------------------
// 代行登録の「その日の空き時間」一覧(客側 step-datetime と同じ見せ方)
// ---------------------------------------------------------------------------

/**
 * 代行登録フォームに渡す空き枠。Server Action の境界を越えるため
 * Date ではなくISO文字列で運ぶ(客側 AvailabilitySlot と同じ形)。
 */
export type ProxyDaySlot = {
  /** 開始時刻(UTCのISO文字列) */
  startISO: string;
  status: SlotStatus;
};

/** 時刻ボタン1個分の表示情報 */
export type ProxySlotOption = {
  /** JSTの壁時計時刻 "HH:MM"。表示ラベルであり <input type="time"> の値でもある */
  time: string;
  /** 埋まっている枠(取り消し線+グレーで選択不可にする。モック準拠) */
  isTaken: boolean;
};

/**
 * 空き枠(UTCのISO)を、時刻ボタン一覧の表示情報に整形する。
 * - JSTの壁時計時刻に直す(そのまま時間フィールドへ反映できるゼロ埋め形式)
 * - taken は「埋まり」として残す(隠さない。客側と同じ取り消し線表示)
 * - 開始時刻の昇順に並べる(入力配列は破壊しない)
 */
export function buildProxySlotOptions(
  slots: ProxyDaySlot[],
): ProxySlotOption[] {
  return [...slots]
    .sort(
      (a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime(),
    )
    .map((slot) => ({
      time: jstClockTime(new Date(slot.startISO)),
      isTaken: slot.status === "taken",
    }));
}
