// 管理画面サイドバーのアクティブ判定(純粋関数)。

/** 末尾スラッシュを取り除いて比較用に正規化する(ルート "/" はそのまま) */
function normalize(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * サイドバーのナビ項目がアクティブかを判定する。
 * ナビ項目のパスとの完全一致のみをアクティブとする
 * (例: /admin/reservations/[id]/edit は「代行登録」をアクティブにしない。
 * /admin はホームなので、配下のページで常時アクティブになるのを避ける)。
 */
export function isAdminNavActive(pathname: string, href: string): boolean {
  return normalize(pathname) === normalize(href);
}
