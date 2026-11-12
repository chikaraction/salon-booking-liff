// 店側変更(モックC「変更」→ 代行登録フォーム=モックD の流用)。
// サーバーコンポーネント: authenticated クライアント(RLS適用)で対象予約・
// スタッフ・メニューを取得し、既存予約の値を初期値に組み立ててフォームへ渡す。
// 認証は保護レイアウトが担う。配線に徹し、判断は src/lib/ の純粋関数に置く:
// - 開始時刻(UTC)→ JSTの日付・時刻の分解は jstCalendarDate / jstClockTime
// - 初期選択メニューの復元(無効化メニューの除外)は restoreSelectableMenuIds
// - 初期選択スタッフの復元(無効のスタッフなら未選択)は restoreSelectableStaffId

import { notFound } from "next/navigation";

import { ProxyRegistrationForm } from "@/app/admin/(protected)/_components/proxy-registration-form";
import {
  restoreSelectableMenuIds,
  restoreSelectableStaffId,
} from "@/lib/admin-reservation-form";
import { isUuid } from "@/lib/booking";
import { jstCalendarDate, jstClockTime } from "@/lib/jst";
import {
  canUseAdminInRender,
  createAdminAuthClient,
} from "@/server/admin-auth";
import {
  fetchActiveMenus,
  fetchAdminStaff,
  fetchReservationDetail,
} from "@/server/admin-data";

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

  // 管理画面を使えないユーザー(未紐付け・無効にされたスタッフ)には保護レイアウトが
  // 案内だけを出す。そのときもページは実行されるので、何も取得せずに終える
  if (!(await canUseAdminInRender())) return null;

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
  // 初期選択スタッフは選べる(有効な)スタッフに含まれるときだけ復元する。
  // 無効のスタッフの予約は未選択から始め、選び直してもらう
  const staffId = restoreSelectableStaffId(
    detail.staffId,
    staff.map((member) => member.id),
  );

  return (
    <ProxyRegistrationForm
      mode="edit"
      reservationId={detail.id}
      staff={staff}
      menus={menus}
      defaultDate={date}
      // 直URLで開いたときの戻り先(その予約の日のカレンダー)。カレンダーからの
      // 「変更」はダイアログ内で完結するのでこのページを経由しないが、
      // ページ自体は残るため行き止まりにしない
      backHref={`/admin?date=${date}`}
      fixedCustomerName={detail.customerName}
      initial={{
        menuIds,
        staffId,
        date,
        time,
        note: detail.requestNote ?? "",
      }}
    />
  );
}
