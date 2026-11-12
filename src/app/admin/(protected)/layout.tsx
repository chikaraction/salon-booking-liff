import { redirect } from "next/navigation";

import {
  ADMIN_NOT_REGISTERED_MESSAGE,
  canUseAdmin,
} from "@/lib/admin-permissions";
import {
  createAdminAuthClient,
  getAdminUser,
  getCurrentStaffForRender,
} from "@/server/admin-auth";
import { fetchSalonName, getAdminMiniSummary } from "@/server/admin-data";

import { AdminSidebar } from "./_components/admin-sidebar";
import { MiniSummary } from "./_components/mini-summary";
import { NotRegisteredLogoutButton } from "./_components/not-registered-logout-button";

// 保護配下のレイアウト。src/middleware.ts のリダイレクトに加えて、ここでも
// 検証済みの getUser でセッションを再確認する(二重チェック:
// docs/milestone-4-plan.md「アクセス制御」)。
export default async function AdminProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getAdminUser();
  if (user === null) {
    redirect("/admin/login");
  }

  // ロールはサーバー側で解決する。有効なスタッフに紐付いていないユーザー
  // (staff.auth_user_id が未紐付け・無効にされたスタッフ)は null になる。
  // このユーザーは RLS で予約系も設定系も0件しか読めず(店名も読めない)、画面を
  // 組み立てられないので、店名やミニ集計を取りに行く前に案内だけを出して終える。
  // children は描かない。ただし Next は children を描かなくても配下のページを実行する
  // ので、ページ側も先頭の canUseAdminInRender() で取得を止めている
  // (問い合わせは getCurrentStaffForRender でページと共有する)
  const currentStaff = await getCurrentStaffForRender();
  const role = currentStaff?.role ?? null;
  if (!canUseAdmin(role)) {
    // 文言の方針は設定の権限不足カード(settings/layout.tsx)と同じ。読み手は自分では
    // 対処できないので、テーブル名・列名・SQLは書かず「誰に確認すればよいか」までに留める。
    // 原因の切り分けは getCurrentStaff() のサーバーログ(auth ユーザーIDのみ)で行う。
    // 本人が取れる次の行動はログアウト(別のアカウントでログインし直す)だけなので、
    // ボタンはそれだけを置く。店名は読めないので出さない
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-8">
          <h1 className="text-lg font-bold text-foreground">
            {ADMIN_NOT_REGISTERED_MESSAGE}
          </h1>
          {/* 1行で書く。JSXは行途中の改行を半角スペースに畳むため、
              日本語を折り返すと文中に空きができてしまう */}
          <p className="mt-3 text-sm text-muted-foreground">
            管理画面は、スタッフとして登録されたアカウントだけが使えます。
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            スタッフなのにこの画面が表示される場合は、管理画面ユーザーの登録が完了していないか、利用が停止されている可能性があります。
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            オーナー、または管理画面のセットアップを担当した方に確認してください。
          </p>
          <NotRegisteredLogoutButton />
        </div>
      </main>
    );
  }

  // 店名はDBから取得(ADR-007)。認証済みなので authenticated クライアント(RLS適用)
  const supabase = await createAdminAuthClient();
  const [salonName, miniSummary] = await Promise.all([
    fetchSalonName(supabase),
    getAdminMiniSummary(supabase, new Date()),
  ]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AdminSidebar
        salonName={salonName}
        // ADR-005: 設定グループはオーナーのみ
        role={role}
        // ミニ集計スロット(今日の予約件数・LINEプッシュ残量バー)
        miniSummary={
          <MiniSummary
            todayReservationCount={miniSummary.todayReservationCount}
            monthlyPushCount={miniSummary.monthlyPushCount}
          />
        }
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
