// サイドバー下部のミニ集計(モックB左下)。プレゼンテーションに徹する。
// 数値は src/server/admin-data.ts の getAdminMiniSummary が用意する。

import { PUSH_MONTHLY_FREE_LIMIT } from "@/server/admin-data";

type Props = {
  todayReservationCount: number;
  monthlyPushCount: number;
};

export function MiniSummary({
  todayReservationCount,
  monthlyPushCount,
}: Props) {
  const pushRatio = Math.min(monthlyPushCount / PUSH_MONTHLY_FREE_LIMIT, 1);
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
          {monthlyPushCount}
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            / {PUSH_MONTHLY_FREE_LIMIT} 通
          </span>
        </p>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={monthlyPushCount}
          aria-valuemin={0}
          aria-valuemax={PUSH_MONTHLY_FREE_LIMIT}
          aria-label="今月のLINEプッシュ送信数"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${pushRatio * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
