import { redirect } from "next/navigation";

import {
  createAdminAuthClient,
  getAdminUser,
  getCurrentStaff,
} from "@/server/admin-auth";
import { fetchSalonName, getAdminMiniSummary } from "@/server/admin-data";

import { AdminSidebar } from "./_components/admin-sidebar";
import { MiniSummary } from "./_components/mini-summary";

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

  // 店名はDBから取得(ADR-007)。認証済みなので authenticated クライアント(RLS適用)
  const supabase = await createAdminAuthClient();
  // ロールはサーバー側で解決してサイドバーに渡す(ADR-005: 設定グループはオーナーのみ)。
  // staff.auth_user_id が未紐付けなら null になり、設定グループは出ない
  const [salonName, miniSummary, currentStaff] = await Promise.all([
    fetchSalonName(supabase),
    getAdminMiniSummary(supabase, new Date()),
    getCurrentStaff(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AdminSidebar
        salonName={salonName}
        role={currentStaff?.role ?? null}
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
