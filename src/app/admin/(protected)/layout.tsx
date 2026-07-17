import { redirect } from "next/navigation";

import { createAdminAuthClient, getAdminUser } from "@/server/admin-auth";
import { fetchSalonName } from "@/server/admin-data";

import { AdminSidebar } from "./_components/admin-sidebar";

// 保護配下のレイアウト。src/proxy.ts のリダイレクトに加えて、ここでも
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
  const salonName = await fetchSalonName(supabase);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AdminSidebar
        salonName={salonName}
        // ミニ集計スロット(今日の予約件数・LINEプッシュ残量バー)は
        // 後続タスク(カレンダー)が埋める。今は空
        miniSummary={null}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
