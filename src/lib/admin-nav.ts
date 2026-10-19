// 管理画面サイドバーのアクティブ判定(純粋関数)。

/** 末尾スラッシュを取り除いて比較用に正規化する(ルート "/" はそのまま) */
function normalize(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** 管理画面ホーム。配下すべてでアクティブにならないよう前方一致から除外する */
const ADMIN_HOME = "/admin";

/**
 * サイドバーのナビ項目がアクティブかを判定する。
 * 完全一致、またはナビ項目を親とする前方一致(区切りは "/")をアクティブとする。
 *
 * 前方一致はM4bで追加した。設定ページは配下に子画面を持ちうるため
 * (例: /admin/settings/staff/[id])、親のナビ項目を光らせたい。
 * ただし /admin はホームなので前方一致から除外する(除外しないと
 * /admin 配下のすべての画面で「予約カレンダー」がアクティブになる)。
 * /admin/reservations/[id]/edit が「代行登録」(/admin/reservations/new)を
 * アクティブにしないのは、そもそも前方一致しないため従来どおり。
 */
export function isAdminNavActive(pathname: string, href: string): boolean {
  const path = normalize(pathname);
  const target = normalize(href);
  if (path === target) {
    return true;
  }
  if (target === ADMIN_HOME) {
    return false;
  }
  return path.startsWith(`${target}/`);
}
