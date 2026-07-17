"use server";

// 管理画面(店側)のServer Action(配線に徹する。判断は src/lib/admin-login.ts)。
// - 認証は Supabase Auth のメール+パスワード(ADR-005)
// - 戻り値は判別可能なResult型でUIが分岐に迷わない形にする
// - セッションcookieの読み書きは createAdminAuthClient(@supabase/ssr)が行う

import { describeLoginError, validateLoginInput } from "@/lib/admin-login";
import { createAdminAuthClient } from "@/server/admin-auth";

export type LoginResult = { ok: true } | { ok: false; message: string };

/** メール+パスワードでログインする。成功時はセッションcookieが設定される */
export async function login(
  email: unknown,
  password: unknown,
): Promise<LoginResult> {
  const input = validateLoginInput(email, password);
  if (!input.ok) {
    return { ok: false, message: input.message };
  }

  try {
    const supabase = await createAdminAuthClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error !== null) {
      return {
        ok: false,
        message: describeLoginError({ code: error.code, status: error.status }),
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("login failed", error);
    return {
      ok: false,
      message: "ログインに失敗しました。時間をおいて再度お試しください",
    };
  }
}

export type LogoutResult = { ok: true } | { ok: false; message: string };

/** ログアウトする。セッションcookieが削除される */
export async function logout(): Promise<LogoutResult> {
  try {
    const supabase = await createAdminAuthClient();
    const { error } = await supabase.auth.signOut();
    if (error !== null) {
      console.error("logout failed", error);
      return { ok: false, message: "ログアウトに失敗しました" };
    }
    return { ok: true };
  } catch (error) {
    console.error("logout failed", error);
    return { ok: false, message: "ログアウトに失敗しました" };
  }
}
