// Cron の入口(/api/cron/reminders)の認証(純粋関数)。
// 公開URLでもあるので、Authorization: Bearer {CRON_SECRET} が一致したときだけ通す。
// 比較は定数時間(一致した文字数で処理時間が変わらないようにする)。
// crypto.subtle.timingSafeEqual は Workers にしか無いので、バイト列の XOR を自前で畳み込む。

const encoder = new TextEncoder();

/** 2つのバイト列が等しいか。長さが違えば false(長さ自体は秘密にしない) */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Authorization ヘッダーの値が「Bearer {secret}」と完全一致するか。
 * ヘッダーが無い・秘密が空文字なら false(「Bearer 」だけで通らないようにする)。
 */
export function isAuthorizedCronRequest(
  authorization: string | null,
  secret: string,
): boolean {
  if (authorization === null || secret.length === 0) return false;
  return constantTimeEqual(
    encoder.encode(authorization),
    encoder.encode(`Bearer ${secret}`),
  );
}
