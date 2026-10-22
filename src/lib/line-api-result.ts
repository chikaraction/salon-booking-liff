// LINE Messaging API の送信系(応答・プッシュ)の応答を解釈する(純粋関数)。
// ステータスコードの意味は Messaging API リファレンス「ステータスコード」
// 「エラーレスポンス」と「失敗したAPIリクエストを再試行する」に従う:
// - 200番台: 受理された(再試行しない)
// - 409: 同じリトライキー(X-Line-Retry-Key)のリクエストが受理済み = 送信済み(再試行しない)
// - それ以外: エラー。本文は { message, details?: [{ message?, property? }] }

/** 送信 API の結果。409 は送信済みとして ok に含め、alreadyAccepted で区別する */
export type LineSendResult =
  | { ok: true; alreadyAccepted: boolean }
  | {
      ok: false;
      /** HTTP ステータス。応答が得られなかった(ネットワーク障害・タイムアウト)ときは null */
      status: number | null;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** details[] を「property: message」の並びにする。形が想定外の要素は捨てる */
function detailsLabel(details: unknown): string {
  if (!Array.isArray(details)) return "";
  const parts: string[] = [];
  for (const detail of details) {
    if (!isRecord(detail) || typeof detail.message !== "string") continue;
    parts.push(
      typeof detail.property === "string"
        ? `${detail.property}: ${detail.message}`
        : detail.message,
    );
  }
  return parts.join(" / ");
}

/**
 * 応答のステータスと本文(JSON をパースしたもの。読めなければ null)から結果を作る。
 * エラー時の message は本文の message(+ details)、無ければ「HTTP {status}」。
 */
export function interpretLineSendResponse(
  status: number,
  body: unknown,
): LineSendResult {
  if (status >= 200 && status < 300) {
    return { ok: true, alreadyAccepted: false };
  }
  if (status === 409) {
    return { ok: true, alreadyAccepted: true };
  }

  if (!isRecord(body) || typeof body.message !== "string") {
    return { ok: false, status, message: `HTTP ${status}` };
  }
  const details = detailsLabel(body.details);
  return {
    ok: false,
    status,
    message: details === "" ? body.message : `${body.message}(${details})`,
  };
}
