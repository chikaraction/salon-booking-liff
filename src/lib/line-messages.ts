// LINEトークに出す文面(M5)の判断ロジック(純粋関数)。
// 予約確認の応答・前日リマインドの本文、客が送る定型文の判定、マイ予約のURLを扱う。
// 文面はテキストメッセージ(Flex は使わない)。店名・メニュー名はすべて DB から渡す(ADR-007)。
// 日時・金額・メニュー名の表記は booking.ts の既存フォーマッタに合わせる(画面と揃える)。

import {
  formatJstDateTimeLabel,
  formatYen,
  menuNamesLabel,
  summarizeSelectedMenus,
} from "./booking";
import type { ReservationMenuSnapshot } from "./my-reservations";

/** 予約確認の種類(新規の予約確定 / 予約変更) */
export type ConfirmationKind = "new" | "change";

/** 客が `liff.sendMessages()` で送る定型文。Webhook はこれと完全一致したときだけ応答する */
export const CONFIRMATION_TRIGGER_TEXTS: Record<ConfirmationKind, string> = {
  new: "予約を確定しました",
  change: "予約を変更しました",
};

/** 文面に載せる予約1件分(メニューは予約時点のスナップショット) */
export type LineReservation = {
  start: Date;
  staffName: string;
  menus: ReservationMenuSnapshot[];
};

/** 文面の末尾に共通で付ける値 */
type LineFooter = {
  /** 店名。空文字(空白だけを含む)なら店名の行を出さない */
  salonName: string;
  /** `myPageUrl(liffId)` で作ったマイ予約のURL */
  myPageUrl: string;
};

export type BookingConfirmationInput = LineReservation &
  LineFooter & { kind: ConfirmationKind };

export type ReminderInput = LineReservation & LineFooter;

/** マイ予約画面のLIFF URL(トーク内で押すとLIFFで開く) */
export function myPageUrl(liffId: string): string {
  return `https://liff.line.me/${liffId}/my`;
}

/** 日時・メニュー・担当の3行(確認とリマインドで共通) */
function reservationLines(reservation: LineReservation): string[] {
  return [
    `日時: ${formatJstDateTimeLabel(reservation.start)}`,
    `メニュー: ${menuNamesLabel(reservation.menus.map((m) => m.menuName))}`,
    `担当: ${reservation.staffName}`,
  ];
}

/** URLと店名の行。店名が空なら URL で終える */
function footerLines(footer: LineFooter): string[] {
  const salonName = footer.salonName.trim();
  return salonName === "" ? [footer.myPageUrl] : [footer.myPageUrl, salonName];
}

const CONFIRMATION_OPENING: Record<ConfirmationKind, string[]> = {
  new: ["ご予約ありがとうございます。", "以下の内容で承りました。"],
  change: ["ご予約の変更を承りました。", "変更後の内容は以下のとおりです。"],
};

/** 予約確認の応答メッセージ(無料の応答枠で返す)。新規と変更は冒頭だけ出し分ける */
export function buildBookingConfirmationText(
  input: BookingConfirmationInput,
): string {
  const summary = summarizeSelectedMenus(input.menus);
  return [
    ...CONFIRMATION_OPENING[input.kind],
    "",
    ...reservationLines(input),
    `合計: ${formatYen(summary.totalPrice)}(約${summary.totalDurationMinutes}分)`,
    "",
    "変更・キャンセルはリッチメニューの「マイ予約」からどうぞ。",
    ...footerLines(input),
  ].join("\n");
}

/** 前日リマインドのプッシュメッセージ(1予約1通、ADR-002) */
export function buildReminderText(input: ReminderInput): string {
  return [
    "【明日のご予約】",
    ...reservationLines(input),
    "",
    "ご来店をお待ちしております。",
    "ご都合が変わった場合は「マイ予約」から変更・キャンセルできます。",
    ...footerLines(input),
  ].join("\n");
}

/**
 * 客の発言が定型文ならその種類を返す。前後の空白(改行・全角スペースを含む)だけ許した完全一致。
 * 言い回しが違うものは店とのふだんのチャットとして扱い、null を返す(Webhook は応答しない)。
 */
export function isConfirmationTrigger(text: string): ConfirmationKind | null {
  const trimmed = text.trim();
  for (const kind of Object.keys(
    CONFIRMATION_TRIGGER_TEXTS,
  ) as ConfirmationKind[]) {
    if (CONFIRMATION_TRIGGER_TEXTS[kind] === trimmed) return kind;
  }
  return null;
}
