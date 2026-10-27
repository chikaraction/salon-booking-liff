import "server-only";

// Supabase service_role クライアント(ADR-003)。
// RLSはanonキー全拒否(ポリシーなし)のため、客側(LIFF)の操作はすべて
// サーバー側で LINE IDトークンを検証したうえでこのクライアント経由で実行する。
// service_role キーはRLSをバイパスするので、絶対にクライアントへ露出させないこと。

import { createClient } from "@supabase/supabase-js";

import type { Database, DbClient } from "@/types/database";

/** モジュールスコープで使い回す(リクエストごとに作り直さない) */
let cached: DbClient | null = null;

/** service_role のSupabaseクライアントを返す */
export function getServiceRoleClient(): DbClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "環境変数 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません",
    );
  }

  cached = createClient<Database>(url, serviceRoleKey, {
    auth: {
      // サーバー専用のキー認証クライアントなので、セッションの保存・自動更新はしない
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
