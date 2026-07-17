import "server-only";

// 管理画面(店側)のデータ取得(配線に徹する)。
// 原則: 店側のDBアクセスは authenticated クライアント(RLS適用)で行い、
// service_role は使わない(docs/milestone-4-plan.md「サーバー・UI」)。
// 例外はログイン画面(未認証で表示する店名)のみ。下記コメント参照。

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleClient } from "@/server/supabase";

/** 店名(salon_settings.name)を取得する(ADR-007: 店舗固有値はDBから) */
export async function fetchSalonName(
  supabase: SupabaseClient,
): Promise<string> {
  const result = await supabase.from("salon_settings").select("name").single();
  if (result.error !== null || result.data === null) {
    throw new Error(
      `店舗設定の取得に失敗しました: ${result.error?.message ?? "データがありません"}`,
    );
  }
  return (result.data as { name: string }).name;
}

/**
 * ログイン画面用の店名取得。
 * ログイン画面は未認証で表示されるため authenticated クライアントでは読めず、
 * anon にはRLSポリシーが無い(全拒否)。店名は客側予約画面でも公開している
 * 情報なので、ここに限り service_role の読み取りを許容する(書き込みはしない)。
 */
export async function fetchSalonNameForLogin(): Promise<string> {
  return fetchSalonName(getServiceRoleClient());
}
