"use client";

// LIFF SDKの薄いラッパー。初期化・IDトークン取得・予約確認の定型文の送信(M5)だけを行い、
// 判断ロジックを持たない。
// - LINEアプリ外で開かれた等でIDトークンが取れないときは null を返す
//   (どう扱うかは呼び出し元が決める)
// - NEXT_PUBLIC_LIFF_STUB=1 のときはLIFF SDKを一切呼ばず固定のダミーIDトークンを返す
//   (通常ブラウザでのスモークテスト用。サーバー側の受け口は src/server/line.ts)

import {
  CONFIRMATION_TRIGGER_TEXTS,
  type ConfirmationKind,
} from "@/lib/line-messages";
import { STUB_TOKEN_PREFIX } from "@/lib/liff-stub";

/** 開発用スタブのダミーIDトークン(サーバー側で "stub:" 以降がuserIdになる) */
const STUB_ID_TOKEN = `${STUB_TOKEN_PREFIX}U-dev-user-1`;

/** liff.init は多重呼び出しできないため、初回のPromiseを共有する */
let initPromise: Promise<void> | null = null;

/**
 * LIFF SDK を読み込み、初期化を(共有の Promise で)待って SDK を返す。
 * 失敗時は例外をそのまま投げる(initPromise の後始末は呼び出し側)。
 */
async function initializedLiff(liffId: string) {
  // スタブモードでSDKを読み込まないよう動的importにする
  const { default: liff } = await import("@line/liff");
  initPromise ??= liff.init({ liffId });
  await initPromise;
  return liff;
}

/**
 * LIFFを初期化してIDトークンを返す。取得できなければ null。
 * (LIFF ID未設定・初期化失敗・LINEログインしていない場合など)
 */
export async function getLineIdToken(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_LIFF_STUB === "1") {
    return STUB_ID_TOKEN;
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    return null;
  }

  try {
    const liff = await initializedLiff(liffId);
    return liff.getIDToken();
  } catch {
    // 初期化失敗は「未認証」として扱う。次回呼び出しで再試行できるようにする
    initPromise = null;
    return null;
  }
}

/**
 * LIFFを初期化するだけ(エントリーページ / 用)。初期化できたら true、
 * LIFF ID未設定・初期化失敗なら false。スタブモードではSDKを呼ばず true。
 * URLに liff.state があり SDK が2次リダイレクトするときは、SDK が
 * location.replace() したあと解決しない Promise を待つため、この Promise も解決しない
 * (@line/liff 2.29.1 の @liff/init で確認。src/lib/liff-entry.ts の冒頭コメント)。
 */
export async function initLiff(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_LIFF_STUB === "1") {
    return true;
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    return false;
  }

  try {
    await initializedLiff(liffId);
    return true;
  } catch {
    initPromise = null;
    return false;
  }
}

/**
 * 予約確認の定型文(CONFIRMATION_TRIGGER_TEXTS)を客の発言として1対1トークに送る(M5)。
 * Webhook がこれを受けて応答メッセージで予約内容を返す。送れたら true。
 * - スタブモードでは送らず false
 * - 1対1トーク以外から開いた(getContext().type が "utou" でない)ときは呼ばずに false
 * - 送信の失敗(chat_message.write 未許可の 403 など)は例外にせず false
 *   (@line/liff 2.29.1: sendMessages は Promise<void> を返し、失敗は reject。
 *    getContext() は Context | null で type は 'utou' | 'room' | 'group' | 'none' | 'square_chat' | 'external')
 */
export async function sendConfirmationMessage(
  kind: ConfirmationKind,
): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_LIFF_STUB === "1") {
    return false;
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    return false;
  }

  try {
    const liff = await initializedLiff(liffId);
    if (liff.getContext()?.type !== "utou") {
      return false;
    }
    await liff.sendMessages([
      { type: "text", text: CONFIRMATION_TRIGGER_TEXTS[kind] },
    ]);
    return true;
  } catch {
    return false;
  }
}
