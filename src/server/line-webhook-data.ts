import "server-only";

// LINE Webhook(M5 予約確認の応答)のデータ取得(配線に徹する)。
// DBの行を src/lib/line-webhook.ts・line-messages.ts が受け取る型に変換して渡す。
// 応答の対象を選ぶ判断(確定済み・kind=booking・作成から10分以内の最新)は
// pickRecentReservation(src/lib/line-webhook.ts)が行う。

import type { LineReservation } from "@/lib/line-messages";
import {
  RECENT_RESERVATION_WINDOW_MINUTES,
  type RecentReservationCandidate,
} from "@/lib/line-webhook";
import { parseTstzrange } from "@/lib/tstzrange";
import { findCustomerByLineUserId } from "@/server/booking-data";
import { getServiceRoleClient } from "@/server/supabase";

const MINUTE_MS = 60 * 1000;

/** pickRecentReservation に渡せて、そのまま文面にも使える予約1件分 */
export type RecentLineReservation = RecentReservationCandidate &
  LineReservation;

/**
 * LINE の userId の客の、最近作成された予約(kind・status は問わない)を返す。
 * 読む量を絞るため作成が now − 10分 以降のものだけ問い合わせる
 * (最終的な選別は呼び出し元が pickRecentReservation で行う)。
 * 顧客が未登録なら空配列。
 */
export async function getRecentReservationsForLineUser(
  lineUserId: string,
  now: Date,
): Promise<RecentLineReservation[]> {
  const customer = await findCustomerByLineUserId(lineUserId);
  if (customer === null) {
    return [];
  }

  const since = new Date(
    now.getTime() - RECENT_RESERVATION_WINDOW_MINUTES * MINUTE_MS,
  );
  const supabase = getServiceRoleClient();
  const result = await supabase
    .from("reservations")
    .select(
      "id, kind, status, created_at, during, staff(name), reservation_menus(menu_name, price, duration_minutes)",
    )
    .eq("customer_id", customer.id)
    .gte("created_at", since.toISOString());
  if (result.error !== null) {
    throw new Error(`直近の予約の取得に失敗しました: ${result.error.message}`);
  }
  // 埋め込みの形は生成された型から推論される(多対一の staff は単一
  // オブジェクト、一対多の reservation_menus は配列)
  const rows = result.data ?? [];

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: new Date(row.created_at),
    start: parseTstzrange(row.during).start,
    staffName: row.staff?.name ?? "",
    menus: row.reservation_menus.map((menu) => ({
      menuName: menu.menu_name,
      price: menu.price,
      durationMinutes: menu.duration_minutes,
    })),
  }));
}

/** 店名(salon_settings.name)。文面の末尾に出す */
export async function getSalonName(): Promise<string> {
  const supabase = getServiceRoleClient();
  const result = await supabase.from("salon_settings").select("name").single();
  if (result.error !== null || result.data === null) {
    throw new Error(
      `店舗設定の取得に失敗しました: ${result.error?.message ?? "データがありません"}`,
    );
  }
  return result.data.name;
}
