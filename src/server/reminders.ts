import "server-only";

// 前日リマインド(M5)の送信と記録(配線に徹する)。Cron(毎時0分)から
// /api/cron/reminders 経由で呼ばれる。判断は src/lib/reminders.ts・line-messages.ts:
//   送ってよい時間帯と翌日の範囲 → reminderWindow
//   送る予約の選別(確定済み・予約・LINEあり・翌日・未送信・送信時刻前に作成)→ selectReminderTargets
//   無料枠の残り → canSendPush / 記録済みの判定 → isPushMessageRecorded / 集計 → summarizeReminderRun
//
// - DB は service_role で読み書きする(Cron には利用者のセッションが無い)
// - プッシュのリトライキーは予約ID(UUID)。送信と記録の間で落ちても、次の時間に同じキーで
//   送り直すと 409(alreadyAccepted)になり、記録だけ追いつく(二重には届かない)
// - push_messages の一意インデックスは部分インデックス(where type = 'reminder')なので、
//   supabase-js の upsert(on_conflict)では推論できない。普通の insert にして、
//   一意制約違反(23505)は「記録済み」として成功扱いにする
// - 1件の失敗で残りを止めない。結果は console.log / console.error で Workers Logs に残す

import { myPageUrl, buildReminderText } from "@/lib/line-messages";
import type { ReservationMenuSnapshot } from "@/lib/my-reservations";
import {
  canSendPush,
  isPushMessageRecorded,
  reminderWindow,
  selectReminderTargets,
  summarizeReminderRun,
  type ReminderOutcome,
  type ReminderReservation,
  type ReminderRunSummary,
} from "@/lib/reminders";
import { formatTstzrange, parseTstzrange } from "@/lib/tstzrange";
import { countPushMessagesThisMonth } from "@/server/admin-data";
import { pushMessage } from "@/server/line-messaging";
import { getServiceRoleClient } from "@/server/supabase";

type ReminderSettingsRow = { name: string; reminder_hour: number };

type ReminderReservationRow = {
  id: string;
  kind: string;
  status: string;
  created_at: string; // timestamptz は ISO 8601 の文字列で返る
  during: string; // tstzrange は文字列で返る
  // 多対一の埋め込みは単一オブジェクト(admin-data.ts と同じ)
  customers: { line_user_id: string | null } | null;
  staff: { name: string } | null;
  // 一対多の埋め込み(予約時点のスナップショット)は配列
  reservation_menus: Array<{
    menu_name: string;
    price: number;
    duration_minutes: number;
  }>;
};

/** selectReminderTargets に渡せて、そのまま文面にも使える予約1件分 */
type ReminderCandidate = ReminderReservation & {
  staffName: string;
  menus: ReservationMenuSnapshot[];
};

/** 店名と送信時刻(salon_settings は1行) */
async function getReminderSettings(): Promise<{
  salonName: string;
  reminderHour: number;
}> {
  const result = await getServiceRoleClient()
    .from("salon_settings")
    .select("name, reminder_hour")
    .single();
  if (result.error !== null || result.data === null) {
    throw new Error(
      `店舗設定の取得に失敗しました: ${result.error?.message ?? "データがありません"}`,
    );
  }
  const row = result.data as ReminderSettingsRow;
  return { salonName: row.name, reminderHour: row.reminder_hour };
}

/**
 * 範囲 [start, endExclusive) に重なる確定済みの予約(kind = booking)を読む。
 * 開始が範囲内か・LINEのユーザーIDがあるかなどの最終判定は selectReminderTargets がする
 */
async function getReservationsOverlapping(
  start: Date,
  endExclusive: Date,
): Promise<ReminderCandidate[]> {
  const result = await getServiceRoleClient()
    .from("reservations")
    .select(
      "id, kind, status, created_at, during, customers(line_user_id), staff(name), reservation_menus(menu_name, price, duration_minutes)",
    )
    .eq("kind", "booking")
    .eq("status", "confirmed")
    // tstzrange の重なり(&&)。PostgREST の ov 演算子(@supabase/postgrest-js の overlaps)
    .overlaps("during", formatTstzrange(start, endExclusive));
  if (result.error !== null) {
    throw new Error(`翌日の予約の取得に失敗しました: ${result.error.message}`);
  }
  const rows = (result.data ?? []) as unknown as ReminderReservationRow[];

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    startsAt: parseTstzrange(row.during).start,
    createdAt: new Date(row.created_at),
    lineUserId: row.customers?.line_user_id ?? null,
    staffName: row.staff?.name ?? "",
    menus: row.reservation_menus.map((menu) => ({
      menuName: menu.menu_name,
      price: menu.price,
      durationMinutes: menu.duration_minutes,
    })),
  }));
}

/** 予約IDのうち、前日リマインドを記録済み(push_messages type = reminder)のもの */
async function getRemindedReservationIds(
  reservationIds: string[],
): Promise<string[]> {
  if (reservationIds.length === 0) return [];
  const result = await getServiceRoleClient()
    .from("push_messages")
    .select("reservation_id")
    .eq("type", "reminder")
    .in("reservation_id", reservationIds);
  if (result.error !== null) {
    throw new Error(
      `送信済みのリマインドの取得に失敗しました: ${result.error.message}`,
    );
  }
  return (result.data as Array<{ reservation_id: string }>).map(
    (row) => row.reservation_id,
  );
}

/** 前日リマインドを送ったことを記録する。23505(記録済み)は成功扱い */
async function recordReminder(
  reservationId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await getServiceRoleClient()
    .from("push_messages")
    .insert({ reservation_id: reservationId, type: "reminder" });
  if (isPushMessageRecorded(result.error?.code ?? null)) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      `${result.error?.code ?? ""} ${result.error?.message ?? ""}`.trim(),
  };
}

/**
 * いまが送信時間帯なら、翌日(JST)の予約の前日リマインドを LINE のプッシュで送り、
 * push_messages に記録する。送れない時間帯なら理由を status にして何もしない。
 */
export async function sendDueReminders(now: Date): Promise<ReminderRunSummary> {
  const { salonName, reminderHour } = await getReminderSettings();
  const window = reminderWindow(now, reminderHour);
  if (!window.sendable) {
    const summary = summarizeReminderRun(window.reason, []);
    console.log("前日リマインド: 送信時間帯ではありません", summary);
    return summary;
  }

  const reservations = await getReservationsOverlapping(
    window.start,
    window.endExclusive,
  );
  const targets = selectReminderTargets(
    reservations,
    await getRemindedReservationIds(reservations.map((r) => r.id)),
    window,
    reminderHour,
  );

  if (targets.length === 0) {
    const summary = summarizeReminderRun("done", []);
    console.log("前日リマインド: 送る予約はありません", summary);
    return summary;
  }

  // マイ予約のURLに使う(ビルド時に埋め込まれる値。送る予約があるときだけ要る)
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    throw new Error("環境変数 NEXT_PUBLIC_LIFF_ID が設定されていません");
  }

  let monthCount = await countPushMessagesThisMonth(
    getServiceRoleClient(),
    now,
  );
  const outcomes: ReminderOutcome[] = [];
  // 無料枠の数え方を正しく保つため1件ずつ順に送る(1日の対象は数件の想定)
  for (const target of targets) {
    if (!canSendPush(monthCount)) {
      outcomes.push("skippedByQuota");
      continue;
    }
    try {
      const result = await pushMessage(
        target.lineUserId as string, // selectReminderTargets が「LINEあり」に絞っている
        buildReminderText({
          start: target.startsAt,
          staffName: target.staffName,
          menus: target.menus,
          salonName,
          myPageUrl: myPageUrl(liffId),
        }),
        target.id,
      );
      if (!result.ok) {
        console.error(
          `前日リマインドの送信に失敗しました(予約 ${target.id}・HTTP ${result.status ?? "応答なし"}): ${result.message}`,
        );
        outcomes.push("failed");
        continue;
      }
      // 409(受理済み)も前に送った1通として無料枠に数える
      monthCount++;

      const recorded = await recordReminder(target.id);
      if (!recorded.ok) {
        console.error(
          `前日リマインドは送信しましたが記録に失敗しました(予約 ${target.id}。次の時間に同じリトライキーで送り直すと記録だけ追いつきます): ${recorded.message}`,
        );
        outcomes.push("failed");
        continue;
      }
      outcomes.push(result.alreadyAccepted ? "alreadyAccepted" : "sent");
    } catch (error) {
      console.error(
        `前日リマインドの処理に失敗しました(予約 ${target.id})`,
        error,
      );
      outcomes.push("failed");
    }
  }

  const summary = summarizeReminderRun("done", outcomes);
  if (summary.skippedByQuota > 0) {
    console.error(
      `前日リマインド: 今月の無料枠を使い切ったため ${summary.skippedByQuota} 件を送りませんでした`,
    );
  }
  console.log("前日リマインド: 完了", { targets: targets.length, ...summary });
  return summary;
}
