// LINE Webhook(M5 予約確認の応答)の判断ロジック(純粋関数)。
// 署名検証・定型文イベントの選別・応答の対象になる直近の予約を扱う。
// 形式は Messaging API リファレンス「Webhook」「Webhookイベントオブジェクト」に従う。
// crypto.subtle は Node 24 と Cloudflare Workers の両方にあるのでここに置ける。

// 客が送る定型文の種類(新規予約・予約変更)。reservations.kind(booking/block)とは別物
import type { ConfirmationKind } from "./line-messages";

const MINUTE_MS = 60 * 1000;

/** 応答の対象にする予約の範囲: 作成からこの分数以内(M5 計画書「決めたいこと」1) */
export const RECENT_RESERVATION_WINDOW_MINUTES = 10;

/** 標準の base64(パディングあり)。atob の寛容な解釈(空白の除去など)を通す前に形を絞る */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!BASE64_PATTERN.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * `x-line-signature` の検証。署名 = 本文(UTF-8)をチャネルシークレットで HMAC-SHA256 した base64。
 * 本文は受け取った文字列のまま渡すこと(パースし直すと一致しない)。
 * 比較は crypto.subtle.verify に任せる(定数時間の比較を自前で書かない)。
 * 不正な base64・空の署名・空のシークレットは例外にせず false。
 */
export async function verifyLineSignature(
  body: string,
  signature: string,
  channelSecret: string,
): Promise<boolean> {
  if (channelSecret.length === 0) return false;
  const signatureBytes = decodeBase64(signature);
  if (signatureBytes === null) return false;
  try {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(channelSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      encoder.encode(body),
    );
  } catch {
    return false;
  }
}

/** 応答してよいイベント1件分 */
export type ConfirmationEvent = {
  replyToken: string;
  userId: string;
  kind: ConfirmationKind;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** イベント1件を選別する。対象外・想定外の形なら null */
function toConfirmationEvent(
  event: unknown,
  classify: (text: string) => ConfirmationKind | null,
): ConfirmationEvent | null {
  if (!isRecord(event) || event.type !== "message") return null;

  // 再送(isRedelivery: true)は捨てる。deliveryContext が無ければ初回とみなす
  const { deliveryContext } = event;
  if (deliveryContext !== undefined) {
    if (!isRecord(deliveryContext)) return null;
    if (deliveryContext.isRedelivery === true) return null;
  }

  // 1対1トークだけ(グループ・複数人トークは店のチャットではないので応答しない)
  const { source } = event;
  if (!isRecord(source) || source.type !== "user") return null;
  const userId = nonEmptyString(source.userId);
  if (userId === null) return null;

  // チャネルが standby のときは応答トークンが含まれない(リファレンス「共通プロパティ」mode)
  const replyToken = nonEmptyString(event.replyToken);
  if (replyToken === null) return null;

  const { message } = event;
  if (!isRecord(message) || message.type !== "text") return null;
  if (typeof message.text !== "string") return null;

  const kind = classify(message.text);
  return kind === null ? null : { replyToken, userId, kind };
}

/**
 * Webhook の本文(パース済み JSON)から、1対1トークの・テキストの・定型文のメッセージイベント
 * だけを選ぶ。定型文の判定は classify(line-messages.ts の isConfirmationTrigger)に任せる。
 * 定型文は「応答してよい合図」にすぎず、応答の中身は userId で DB から引いて作る。
 * 形が想定外の要素は例外にせず捨てる。
 */
export function pickConfirmationEvents(
  payload: unknown,
  classify: (text: string) => ConfirmationKind | null,
): ConfirmationEvent[] {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return [];
  const picked: ConfirmationEvent[] = [];
  for (const event of payload.events) {
    const confirmation = toConfirmationEvent(event, classify);
    if (confirmation !== null) picked.push(confirmation);
  }
  return picked;
}

/** pickRecentReservation の入力(サーバー層が DB の行から作る) */
export type RecentReservationCandidate = {
  id: string;
  createdAt: Date;
  status: string;
  kind: string;
};

/**
 * 応答の対象になる予約: 確定済みの予約(kind = booking)で、作成が
 * [now − 10分, now] に入るもののうち作成が最新の1件。無ければ null(応答しない)。
 */
export function pickRecentReservation<T extends RecentReservationCandidate>(
  reservations: readonly T[],
  now: Date,
): T | null {
  const nowMs = now.getTime();
  const fromMs = nowMs - RECENT_RESERVATION_WINDOW_MINUTES * MINUTE_MS;
  let latest: T | null = null;
  for (const reservation of reservations) {
    if (reservation.kind !== "booking" || reservation.status !== "confirmed") {
      continue;
    }
    const createdMs = reservation.createdAt.getTime();
    if (createdMs < fromMs || createdMs > nowMs) continue;
    if (latest === null || createdMs > latest.createdAt.getTime()) {
      latest = reservation;
    }
  }
  return latest;
}
