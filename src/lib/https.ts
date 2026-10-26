// http → https の転送と HSTS の判断(純粋関数)。配線はリポジトリ直下の worker.ts。
// 本番(workers.dev)は http でもページを返してしまうため、http のアクセスは
// https へ転送する。ローカル実行(npm run dev / wrangler dev)は http のままにする。

/** ローカル実行とみなすホスト名(URL.hostname の表記。IPv6 は角括弧付き) */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Strict-Transport-Security ヘッダーの値(1年間 https を強制する)。
 * includeSubDomains と preload は付けない(workers.dev は共有ドメインで、自分のものではないサブドメインがあるため)。
 */
export const HSTS_HEADER_VALUE = "max-age=31536000";

/**
 * http のURLなら、同じホスト・パス・クエリの https URL を返す。転送不要なら null。
 * https のURL・ローカル実行のホスト・URLとして解釈できない文字列は転送しない。
 */
export function httpsRedirectUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:") return null;
  if (LOCAL_HOSTNAMES.has(parsed.hostname)) return null;
  parsed.protocol = "https:";
  return parsed.toString();
}
