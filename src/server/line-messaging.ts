import "server-only";

// LINE Messaging API の送信(M5)。fetch だけで書く薄いラッパー(SDK は入れない。line.ts と同じ書き方)。
// 応答の解釈は src/lib/line-api-result.ts の純粋関数に任せる。
//
// 仕様(Messaging API リファレンスで確認済み):
//   応答メッセージ: POST https://api.line.me/v2/bot/message/reply
//     ヘッダー: Content-Type: application/json / Authorization: Bearer {channel access token}
//     本文: { replyToken, messages: [{ type: "text", text }] }(messages は最大5件)
//     応答トークンは1回だけ・Webhook 受信から1分以内に使う。X-Line-Retry-Key を付けると 400
//     https://developers.line.biz/ja/reference/messaging-api/#send-reply-message
//   プッシュメッセージ: POST https://api.line.me/v2/bot/message/push
//     ヘッダー: 上記 + X-Line-Retry-Key: {16進表記の UUID}(最初のリクエストから24時間有効)
//     本文: { to, messages: [{ type: "text", text }] }
//     受理済みのリトライキーで再送すると 409(二重には送られない)
//     https://developers.line.biz/ja/reference/messaging-api/#send-push-message
//     https://developers.line.biz/ja/docs/messaging-api/retrying-api-request/
//   エラー本文: { message, details?: [{ message, property }] }

import {
  interpretLineSendResponse,
  type LineSendResult,
} from "@/lib/line-api-result";

export type { LineSendResult } from "@/lib/line-api-result";

const REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
const PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

/** 環境変数の欠落は送信エラーではなくサーバー設定ミスなので例外にする */
function channelAccessToken(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error("環境変数 LINE_CHANNEL_ACCESS_TOKEN が設定されていません");
  }
  return token;
}

/** 送信 API を呼び、応答を LineSendResult にする。ネットワーク障害は status: null */
async function postMessage(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<LineSendResult> {
  const token = channelAccessToken();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: `LINE API に接続できませんでした: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    // JSON でない応答は本文なしで扱う
  }
  return interpretLineSendResponse(response.status, responseBody);
}

/**
 * 応答メッセージ(無料の応答枠)でテキストを1通返す。
 * 応答トークンは1回だけ使える。リトライキーは付けない(付けると 400)。
 */
export async function replyMessage(
  replyToken: string,
  text: string,
): Promise<LineSendResult> {
  return postMessage(
    REPLY_ENDPOINT,
    {},
    { replyToken, messages: [{ type: "text", text }] },
  );
}

/**
 * プッシュメッセージでテキストを1通送る(無料通数を消費する)。
 * retryKey は16進表記の UUID。同じキーで再送しても二重には送られず、
 * 受理済みなら { ok: true, alreadyAccepted: true }(HTTP 409)が返る。
 */
export async function pushMessage(
  to: string,
  text: string,
  retryKey: string,
): Promise<LineSendResult> {
  return postMessage(
    PUSH_ENDPOINT,
    { "X-Line-Retry-Key": retryKey },
    { to, messages: [{ type: "text", text }] },
  );
}
