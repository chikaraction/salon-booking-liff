// Cloudflare Workers のカスタムワーカー(M5 前日リマインドの Cron)。
// wrangler.jsonc の main がこのファイルを指す。OpenNext が生成するワーカー
// (.open-next/worker.js)は fetch しか export しないので、scheduled を足して export し直す
// (OpenNext「Custom Worker」https://opennext.js.org/cloudflare/howtos/custom-worker)。
//
// - fetch: OpenNext の handler をそのまま使う
// - scheduled: 同じ handler の fetch を Worker の中で呼び、/api/cron/reminders を実行する
//   (ネットワークに出ない。リマインドの処理は Next の中にあり、Supabase クライアントや
//   server-only をそのまま使える)。送るかどうかは src/server/reminders.ts が決める
//
// 置き場所はリポジトリ直下。.open-next/worker.js は opennextjs-cloudflare build の生成物で
// npm run build(next build)の時点では無いことがあるので、tsconfig.json の exclude で
// next build の型チェックから外している(バンドルは wrangler の esbuild が行う)。
// Cloudflare の型(@cloudflare/workers-types)は入れていないので、使う分だけ下に書く。

import handler from "./.open-next/worker.js";

/** Worker の環境(Variables and Secrets)。ここで使うのは CRON_SECRET だけ */
type Env = { CRON_SECRET?: string } & Record<string, unknown>;

/** ExecutionContext のうち使うもの */
type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

/** ScheduledController のうちログに出すもの */
type ScheduledController = { cron: string; scheduledTime: number };

type Handler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

const openNext = handler as Handler;

/** scheduled から内部で呼ぶURL。ホスト名は使われない(同じ Worker の handler に直接渡す) */
const CRON_REMINDERS_URL = "https://internal/api/cron/reminders";

async function runReminders(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const response = await openNext.fetch(
    new Request(CRON_REMINDERS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET ?? ""}` },
    }),
    env,
    ctx,
  );
  if (!response.ok) {
    console.error(
      `Cron(${controller.cron})の前日リマインドが失敗しました: HTTP ${response.status}`,
      await response.text(),
    );
  }
}

const worker = {
  fetch: openNext.fetch,

  // Cron Triggers(wrangler.jsonc の triggers.crons)。毎時0分に呼ばれる
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runReminders(controller, env, ctx).catch((error: unknown) => {
        console.error(
          `Cron(${controller.cron})の前日リマインドの呼び出しに失敗しました`,
          error,
        );
      }),
    );
  },
};

export default worker;
