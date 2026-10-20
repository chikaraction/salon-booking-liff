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
//   管理画面ユーザーの紐付け漏れでオーナーが弾かれるケースもあり、
//   原因が画面に出ていないと運用で詰まる(READMEの紐付け手順を参照)
//
// 本文にテーブル名・列名・SQLは書かない。このカードの読み手はスタッフロールか、
// 紐付けが済んでいないユーザーであり、どちらも自分では対処できない立場にある。
// 対処できない相手にスキーマの内部構造だけが伝わるのは損でしかないので、
// 画面では「誰に確認すればよいか」までに留め、具体的な紐付け手順はREADMEに任せる。
// 原因の切り分けは getCurrentStaff() のサーバーログ(auth ユーザーIDのみ)で行う。
// オーナー専用のスタッフ設定画面(staff-settings-form.tsx)も読み手はオーナーで
// アカウントを作る権限がないため、同じ方針(内部構造を出さない)に揃えてある。
export default async function AdminSettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staff = await getCurrentStaff();
  if (!canManageSettings(staff?.role ?? null)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-lg font-bold text-foreground">
            {SETTINGS_PERMISSION_DENIED_MESSAGE}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            設定の変更はオーナーのみが行えます。
          </p>
          {/* 1行で書く。JSXは行途中の改行を半角スペースに畳むため、
              日本語を折り返すと文中に空きができてしまう */}
          <p className="mt-2 text-sm text-muted-foreground">
            オーナーなのにこの画面が表示される場合は、管理画面ユーザーの登録が完了していない可能性があります。
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            管理画面のセットアップを担当した方に確認してください。
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
