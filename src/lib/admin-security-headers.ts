// 管理画面(/admin 配下)の応答に付けるセキュリティヘッダー。配線は src/middleware.ts。
// 他サイトの iframe に管理画面を埋め込ませない(クリックジャッキング対策)。
// X-Frame-Options は古いブラウザ向け、CSP の frame-ancestors はその後継で、両方付ける。

/** 管理画面の応答に付けるヘッダー(ヘッダー名 → 値) */
export const ADMIN_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  // frame-ancestors だけにする(script-src などを入れると Next のインラインスクリプトが壊れる)
  "Content-Security-Policy": "frame-ancestors 'none'",
};
