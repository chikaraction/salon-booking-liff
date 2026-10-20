// ダッシュボード小物(モックG)= 今日の予約件数・今月の予約・今月のLINEプッシュ送信数。
// サーバーコンポーネント: authenticated クライアント(RLS適用)で数値を取得し、
// 内訳・先月比・無料枠の判断は純粋関数(src/lib/dashboard.ts)に任せる配線に徹する。
// 認証は保護レイアウトが担う。閲覧はオーナー・スタッフとも可
// (docs/milestone-4c-plan.md「すり合わせ済みの決定」3)。

import {
  formatMonthOverMonth,
  formatStaffBreakdown,
  pushQuotaMessage,
  pushQuotaStatus,
  summarizeTodayByStaff,
} from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { createAdminAuthClient } from "@/server/admin-auth";
import { getDashboardSummary } from "@/server/admin-data";

const cardClass = "rounded-2xl bg-card p-6 md:p-8";
const cardLabelClass = "text-sm font-bold text-muted-foreground";
const bigNumberClass = "text-[40px] leading-none font-bold text-foreground";
const unitClass = "ml-1.5 text-lg font-medium text-muted-foreground";
const noteClass = "mt-4 text-sm text-muted-foreground";

export default async function DashboardPage() {
  const supabase = await createAdminAuthClient();
  const summary = await getDashboardSummary(supabase, new Date());

  const breakdown = formatStaffBreakdown(
    summarizeTodayByStaff(summary.todayStaffIds, summary.staff),
  );
  const quota = pushQuotaStatus(summary.monthlyPushCount);
  const isQuotaAlert = quota.level !== "ok";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-bold text-foreground">ダッシュボード</h1>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className={cardClass}>
          <h2 className={cardLabelClass}>今日の予約件数</h2>
          <p className="mt-4">
            <span className={bigNumberClass}>
              {summary.todayStaffIds.length}
            </span>
            <span className={unitClass}>件</span>
          </p>
          {breakdown !== "" && <p className={noteClass}>{breakdown}</p>}
        </section>

        <section className={cardClass}>
          <h2 className={cardLabelClass}>今月の予約</h2>
          <p className="mt-4">
            <span className={bigNumberClass}>{summary.thisMonthCount}</span>
            <span className={unitClass}>件</span>
          </p>
          <p className={noteClass}>
            {formatMonthOverMonth(
              summary.thisMonthCount,
              summary.lastMonthCount,
            )}
          </p>
        </section>
      </div>

      <section className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={cardLabelClass}>今月のLINEプッシュ送信数</h2>
          <p className="text-sm text-muted-foreground">
            無料枠 {quota.limit}通
          </p>
        </div>
        <p className="mt-4">
          <span className={bigNumberClass}>{quota.count}</span>
          <span className={unitClass}>/ {quota.limit} 通</span>
        </p>
        <div
          className="mt-5 h-3 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={quota.count}
          aria-valuemin={0}
          aria-valuemax={quota.limit}
          aria-label="今月のLINEプッシュ送信数"
        >
          <div
            className={cn(
              "h-full rounded-full",
              isQuotaAlert ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${quota.ratio * 100}%` }}
          />
        </div>
        <p
          className={cn(
            "mt-3 text-sm",
            isQuotaAlert ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {pushQuotaMessage(quota)}
        </p>
      </section>
    </div>
  );
}
