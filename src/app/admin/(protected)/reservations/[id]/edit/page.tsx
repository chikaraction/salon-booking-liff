// 店側変更(モックC「変更」→ 代行登録フォーム=モックD の流用)。
// サーバーコンポーネント: authenticated クライアント(RLS適用)で対象予約・
// スタッフ・メニューを取得し、既存予約の値を初期値に組み立ててフォームへ渡す。
// 認証は保護レイアウトが担う。配線に徹し、判断は src/lib/ の純粋関数に置く:
// - 開始時刻(UTC)→ JSTの日付・時刻の分解は jstCalendarDate / jstClockTime
// - 初期選択メニューの復元(無効化メニューの除外)は restoreSelectableMenuIds

import { notFound } from "next/navigation";

import { restoreSelectableMenuIds } from "@/lib/admin-reservation-form";
import { jstCalendarDate, jstClockTime } from "@/lib/availability";
import { isUuid } from "@/lib/booking";
import { createAdminAuthClient } from "@/server/admin-auth";
import {
  fetchActiveMenus,
  fetchAdminStaff,
  fetchReservationDetail,
} from "@/server/admin-data";

import { ProxyRegistrationForm } from "../../new/_components/proxy-registration-form";

export default async function EditReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // URL由来の値なのでUUID形式を先に確認する(不正な形式は存在しないのと同じ扱い)
  if (!isUuid(id)) {
    notFound();
  }

  const supabase = await createAdminAuthClient();
  const [detail, staff, menus] = await Promise.all([
    fetchReservationDetail(supabase, id),
    fetchAdminStaff(supabase),
    fetchActiveMenus(supabase),
  ]);

  // 存在しない・ブロック・キャンセル済みは詳細が取れない(予約IDの存在を漏らさない)
  if (detail === null) {
    notFound();
  }

  const date = jstCalendarDate(detail.start);
  const time = jstClockTime(detail.start);
  // 初期選択メニューは現在も有効なものだけ復元(無効化・改定で消えた分は落とす)
  const menuIds = restoreSelectableMenuIds(
    detail.menuIds,
    menus.map((menu) => menu.id),
  );

  return (
    <ProxyRegistrationForm
      mode="edit"
      reservationId={detail.id}
      staff={staff}
      menus={menus}
      defaultDate={date}
      fixedCustomerName={detail.customerName}
      initial={{
        menuIds,
        staffId: detail.staffId,
        date,
        time,
        note: detail.requestNote ?? "",
      }}
    />
  );
}
