// 前日リマインド(M5)の Cron の入口。配線に徹する。
// カスタムワーカー(worker.ts)の scheduled が毎時0分に、同じ Worker の中でこのルートを
// POST で呼ぶ(ネットワークには出ない)。送るかどうか・誰に送るかは src/server/reminders.ts
// (判断は src/lib/reminders.ts)が決める。
//
// - 公開URLでもあるので Authorization: Bearer {CRON_SECRET} が一致しなければ 401
//   (比較は定数時間。src/lib/cron-auth.ts)
// - 処理中の例外はそのまま投げて 500 にする(scheduled 側が 2xx 以外を console.error する)

import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { sendDueReminders } from "@/server/reminders";

export async function POST(request: Request): Promise<Response> {
  // 環境変数の欠落はサーバー設定ミスなので例外にする(line.ts と同じ扱い)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("環境変数 CRON_SECRET が設定されていません");
  }

  if (
    !isAuthorizedCronRequest(request.headers.get("authorization"), cronSecret)
  ) {
    return new Response(null, { status: 401 });
  }

  const summary = await sendDueReminders(new Date());
  return Response.json(summary);
}
