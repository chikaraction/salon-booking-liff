import "server-only";

// 管理画面(店側)の認証まわり(ADR-005)。
// - Supabase Auth のメール+パスワードでログインした店側スタッフのセッションを
//   cookieで保持する(@supabase/ssr の createServerClient)
// - このクライアントは anon キー + セッションの authenticated ロールで動作し、
//   RLSが適用される。管理画面のDBアクセスは必ずこちらを使い、service_role は使わない
// - 認可判定は getSession ではなく getUser を使う(Auth サーバーでJWTを検証した
//   ユーザーだけを信頼する。cookie由来のセッションは改ざんされうるため)

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Supabase の URL / anon キーを環境変数から取得する(未設定なら例外) */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません",
    );
  }
  return { url, anonKey };
}

/**
 * cookieベースのサーバー用Supabaseクライアントを作る。
 * リクエストごとに必ず新しく作る(@supabase/ssr の型定義コメントの指示。
 * リクエスト間でクライアントを共有してはいけない)。
 */
export async function createAdminAuthClient(): Promise<SupabaseClient> {
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Component からは cookie を書けない(Next.jsの制約)。
          // トークン更新の書き戻しは src/proxy.ts が行うため、ここでは無視してよい
        }
      },
    },
  });
}

/**
 * ログイン中の店側スタッフ(Supabase Authユーザー)を返す。未ログインなら null。
 * Auth サーバーで検証済みの getUser を使う(保護レイアウトの二重チェック用)。
 */
export async function getAdminUser(): Promise<User | null> {
  const supabase = await createAdminAuthClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) {
    return null;
  }
  return data.user;
}
