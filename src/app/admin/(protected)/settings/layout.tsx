import Link from "next/link";

import {
  SETTINGS_PERMISSION_DENIED_MESSAGE,
  canManageSettings,
} from "@/lib/admin-permissions";
import { getCurrentStaff } from "@/server/admin-auth";

// 設定系(/admin/settings/*)の保護レイアウト。ADR-005 の「設定はオーナーのみ」を
// アプリ層で担保する。RLS(オーナー以外は設定系テーブルを変更できない)との二重。
//
// アプリ層のチェックが必要な理由: RLSのUPDATE/DELETEはポリシーに合致しない行を
// 「見えない行」として扱うため、スタッフが設定を更新してもエラーにならず
// 「0行更新」で静かに成功する。画面側で先に弾かないと「保存できたように見える」
// バグになる(INSERTだけは 42501 で失敗する)。
//
// 弾き方は「/admin へのリダイレクト」ではなく「権限がありませんの表示」にした。
// - 未ログインの redirect(保護レイアウト・proxy.ts)は、ログイン画面という
//   ユーザーが取れる次の行動があるので遷移させる意味がある
// - 権限不足は本人には解消できず、黙って別画面へ飛ばすと操作を見失う。
//   staff.auth_user_id の紐付け漏れでオーナーが弾かれるケースもあり、
//   原因が画面に出ていないと運用で詰まる(READMEの紐付け手順を参照)
export default async function AdminSettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await getCurrentStaff();
  if (!canManageSettings(staff?.role ?? null)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-2xl bg-card p-8">
          <h1 className="text-lg font-bold text-foreground">
            {SETTINGS_PERMISSION_DENIED_MESSAGE}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            設定の変更はオーナーのみが行えます。オーナーのはずが表示される場合は、
            管理画面ユーザーとスタッフの紐付け(staff.auth_user_id)が
            済んでいない可能性があります。
          </p>
          <Link
            href="/admin"
            className="mt-6 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-base font-bold text-primary-foreground transition-colors hover:opacity-90"
          >
            予約カレンダーへ戻る
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
