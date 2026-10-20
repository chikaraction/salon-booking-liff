// サイドバー下部のミニ集計(モックB左下)。プレゼンテーションに徹する。
// 数値は src/server/admin-data.ts の getAdminMiniSummary が用意する。
// 無料枠の状態・警告文は純粋関数(src/lib/dashboard.ts)が判断する(ADR-002)。

import { pushQuotaShortMessage, pushQuotaStatus } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

type Props = {
  todayReservationCount: number;
  monthlyPushCount: number;
};

export function MiniSummary({
  todayReservationCount,
  monthlyPushCount,
}: Props) {
  const quota = pushQuotaStatus(monthlyPushCount);
  const warning = pushQuotaShortMessage(quota);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground">今日の予約</p>
        <p className="mt-0.5 text-2xl font-bold">
          {todayReservationCount}
          <span className="ml-1 text-sm font-medium text-muted-foreground">
            件
          </span>
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">LINEプッシュ(今月)</p>
        <p className="mt-0.5 text-lg font-bold">
          {quota.count}
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            / {quota.limit} 通
          </span>
        </p>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={quota.count}
          aria-valuemin={0}
          aria-valuemax={quota.limit}
          aria-label="今月のLINEプッシュ送信数"
        >
          <div
            className={cn(
              "h-full rounded-full",
              quota.level === "ok" ? "bg-primary" : "bg-destructive",
            )}
            style={{ width: `${quota.ratio * 100}%` }}
          />
        </div>
        {/* 全画面に常時出るため role="alert" は付けない(毎回読み上げが走る) */}
        {warning !== null && (
          <p className="mt-1.5 text-xs text-destructive">{warning}</p>
        )}
      </div>
    </div>
  );
}
