// /admin 配下のアクセス制御の振り分け(純粋関数)。配線は src/middleware.ts。ADR-005。
//
// - 未ログインでログイン画面以外 → ログイン画面へ
// - ログイン済みでログイン画面 → /admin へ
// fetch で送る Server Action の要求は、普通のリダイレクト(307)にすると壊れるので
// Server Action 向けのリダイレクトにする(理由は middleware.ts の冒頭コメント)。

export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_HOME_PATH = "/admin";

/** 振り分けに使う要求の情報 */
export type AdminAccessRequest = {
  /** 要求のパス(クエリを含まない) */
  pathname: string;
  /** 検証済みのログインユーザーがいるか */
  isLoggedIn: boolean;
  /** HTTP メソッド */
  method: string;
  /** next-action ヘッダーがあるか */
  hasActionHeader: boolean;
};

export type AdminAccessDecision =
  /** そのまま通す */
  | { kind: "pass" }
  /** 普通のリダイレクト(307) */
  | { kind: "redirect"; path: string }
  /** Server Action 向けのリダイレクト(200 + x-action-redirect ヘッダー) */
  | { kind: "action_redirect"; path: string };

/**
 * fetch で送る Server Action の要求か。
 * Next の判定(next/dist/server/lib/server-action-request-meta.js の isFetchAction:
 * method が POST で next-action ヘッダーがある)に合わせる。
 * JS なしのフォーム送信(ヘッダーなしの POST)はブラウザがページ遷移として扱うので含めない。
 */
function isFetchAction(request: AdminAccessRequest): boolean {
  return request.method === "POST" && request.hasActionHeader;
}

/** /admin 配下の要求を通すか、どこへリダイレクトするかを決める */
export function decideAdminAccess(
  request: AdminAccessRequest,
): AdminAccessDecision {
  const isLoginPage = request.pathname === ADMIN_LOGIN_PATH;
  let path: string;
  if (!request.isLoggedIn && !isLoginPage) {
    path = ADMIN_LOGIN_PATH;
  } else if (request.isLoggedIn && isLoginPage) {
    path = ADMIN_HOME_PATH;
  } else {
    return { kind: "pass" };
  }
  return isFetchAction(request)
    ? { kind: "action_redirect", path }
    : { kind: "redirect", path };
}
