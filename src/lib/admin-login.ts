// 管理画面ログインの判断ロジック(純粋関数)。
// - 入力検証と、Supabase Authエラーの日本語メッセージ化
// - UI・Server Actionは配線に徹し、判断はここに集約する

export type LoginValidation =
  | { ok: true; email: string; password: string }
  | { ok: false; message: string };

/**
 * ログインフォームの入力を検証する。
 * FormData.get の戻り値(文字列以外がありうる)をそのまま受け付ける。
 * メールは前後の空白をトリムし、パスワードはトリムしない
 * (空白を含むパスワードを壊さないため)。
 */
export function validateLoginInput(
  email: unknown,
  password: unknown,
): LoginValidation {
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (trimmedEmail === "") {
    return { ok: false, message: "メールアドレスを入力してください" };
  }
  if (typeof password !== "string" || password === "") {
    return { ok: false, message: "パスワードを入力してください" };
  }
  return { ok: true, email: trimmedEmail, password };
}

/**
 * Supabase Auth のログインエラーを利用者向けの日本語メッセージにする。
 * - invalid_credentials / HTTP 400系 → 認証情報の誤り(どちらが誤りかは明かさない)
 * - それ以外(サーバー障害・ネットワーク断等)→ 汎用メッセージ
 * コード一覧は @supabase/auth-js の ErrorCode 型で確認済み。
 */
export function describeLoginError(error: {
  code?: string;
  status?: number;
}): string {
  if (
    error.code === "invalid_credentials" ||
    (error.status !== undefined && error.status >= 400 && error.status < 500)
  ) {
    return "メールアドレスまたはパスワードが違います";
  }
  return "ログインに失敗しました。時間をおいて再度お試しください";
}
