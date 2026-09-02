"use server";

// 設定系(営業日・スタッフ・メニュー・店舗設定)のServer Action。
// 実施順序5〜8で各設定の保存アクションがここに増える。
//
// 置き場所: 設定レイアウトと同じディレクトリに置き、設定系のアクションをまとめる
// (予約運用のアクションは src/app/admin/actions.ts のまま。権限の前提が違うため
//  ファイルを分ける。予約系はスタッフも実行できる: ADR-005)。
//
// 【後続タスクへ】設定系のアクションは必ず先頭で requireOwner()
// (@/server/admin-auth)を通すこと:
//
//   const guard = await requireOwner();
//   if (!guard.ok) return { ok: false, message: guard.message };
//
// requireOwner を "use server" のこのファイルではなく server-only の
// @/server/admin-auth に置いているのは、ここから export した関数がすべて
// クライアントから呼べるServer Actionエンドポイントになるため。
// ガードは呼び出し口を持つ必要がない。
//
// なぜアプリ層でも判定するか(RLSだけでは足りない理由):
// RLSのUPDATE/DELETEは、ポリシーに合致しない行を「存在しない行」として扱う。
// そのためスタッフが設定系テーブルをUPDATE/DELETEしてもエラーにはならず、
// 「0行更新」で静かに成功してしまう(INSERTだけは 42501 で失敗する)。
// アプリ層で先に弾かないと「保存できたように見えるのに何も変わっていない」
// というバグになる。RLSは迂回されたときの最後の砦、アプリ層はUXの防波堤。

import { revalidatePath } from "next/cache";

import {
  DATE_OVERRIDE_OVERLAP_MESSAGE,
  findOverlappingOverride,
  flattenNthWeekdayGroups,
  isDateRangeOverlapError,
  validateDateOverride,
  validateWeeklyBusinessHours,
  type DateOverrideInput,
  type NthWeekdayGroup,
  type WeeklyHoursInput,
} from "@/lib/business-settings";
import { isUuid } from "@/lib/booking";
import { createAdminAuthClient, requireOwner } from "@/server/admin-auth";
import { fetchDateOverrides } from "@/server/settings-data";

/** 設定系アクションの戻り値(既存のアクションと同じ判別可能なResult型) */
export type SettingsActionResult =
  { ok: true } | { ok: false; message: string };

/** 営業日・営業時間の設定画面のパス(保存後の再検証に使う) */
const BUSINESS_SETTINGS_PATH = "/admin/settings/business";

/**
 * 休業日ルールは客側の予約画面・管理画面カレンダーの両方に効くので、
 * 設定画面だけでなく管理画面のカレンダーも再検証する。
 */
function revalidateBusinessSettings(): void {
  revalidatePath(BUSINESS_SETTINGS_PATH);
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// 毎週の定休日 + 曜日ごとの営業時間(business_hours)
// ---------------------------------------------------------------------------

/**
 * 毎週の定休日(チップ)と曜日ごとの営業時間をまとめて保存する。
 * 検証は business-settings.ts の純粋関数(DB制約と同じルール)。
 * business_hours は weekday が主キーなので7件のupsert1回で足りる。
 */
export async function saveWeeklyBusinessHours(
  input: WeeklyHoursInput[],
): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  const validated = validateWeeklyBusinessHours(input);
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }

  try {
    const supabase = await createAdminAuthClient();
    const { error } = await supabase.from("business_hours").upsert(
      validated.value.map((day) => ({
        weekday: day.weekday,
        is_open: day.isOpen,
        open_time: day.openTime,
        close_time: day.closeTime,
      })),
      { onConflict: "weekday" },
    );
    if (error !== null) {
      console.error("saveWeeklyBusinessHours failed", error);
      return { ok: false, message: "営業時間の保存に失敗しました" };
    }
    revalidateBusinessSettings();
    return { ok: true };
  } catch (error) {
    console.error("saveWeeklyBusinessHours failed", error);
    return { ok: false, message: "営業時間の保存に失敗しました" };
  }
}

// ---------------------------------------------------------------------------
// 特定の週だけの定休日(nth_weekday_closures)
// ---------------------------------------------------------------------------

/**
 * 第◯曜日の定休を保存する。
 * UIの1ブロック(曜日 + 第1〜第5の複数選択)を (weekday, nth) の行集合へ
 * 展開し、全削除 → まとめてinsertで置き換える(数行しか無いテーブルであり、
 * 差分upsertより「画面の状態がそのまま入る」ほうが読みやすい)。
 */
export async function saveNthWeekdayClosures(
  groups: NthWeekdayGroup[],
): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  const rows = flattenNthWeekdayGroups(groups);
  if (rows.some((row) => row.weekday < 0 || row.weekday > 6)) {
    return { ok: false, message: "曜日の指定が正しくありません" };
  }
  if (rows.some((row) => row.nth < 1 || row.nth > 5)) {
    return { ok: false, message: "第◯週の指定が正しくありません" };
  }

  try {
    const supabase = await createAdminAuthClient();
    // PostgRESTは無条件のDELETEを受け付けないので、常に真になる条件を付ける
    const deleteResult = await supabase
      .from("nth_weekday_closures")
      .delete()
      .gte("weekday", 0);
    if (deleteResult.error !== null) {
      console.error("saveNthWeekdayClosures failed", deleteResult.error);
      return { ok: false, message: "定休日の保存に失敗しました" };
    }

    if (rows.length > 0) {
      const insertResult = await supabase
        .from("nth_weekday_closures")
        .insert(rows.map((row) => ({ weekday: row.weekday, nth: row.nth })));
      if (insertResult.error !== null) {
        console.error("saveNthWeekdayClosures failed", insertResult.error);
        return { ok: false, message: "定休日の保存に失敗しました" };
      }
    }

    revalidateBusinessSettings();
    return { ok: true };
  } catch (error) {
    console.error("saveNthWeekdayClosures failed", error);
    return { ok: false, message: "定休日の保存に失敗しました" };
  }
}

// ---------------------------------------------------------------------------
// 祝日を休業にするトグル(salon_settings.close_on_holidays)
// ---------------------------------------------------------------------------

/** 「祝日を休業にする」トグルを保存する(salon_settings は単一行) */
export async function saveCloseOnHolidays(
  closeOnHolidays: boolean,
): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  try {
    const supabase = await createAdminAuthClient();
    const { error } = await supabase
      .from("salon_settings")
      .update({ close_on_holidays: closeOnHolidays })
      .eq("id", true);
    if (error !== null) {
      console.error("saveCloseOnHolidays failed", error);
      return { ok: false, message: "祝日の設定の保存に失敗しました" };
    }
    revalidateBusinessSettings();
    return { ok: true };
  } catch (error) {
    console.error("saveCloseOnHolidays failed", error);
    return { ok: false, message: "祝日の設定の保存に失敗しました" };
  }
}

// ---------------------------------------------------------------------------
// 臨時休業・指定日(date_overrides)
// ---------------------------------------------------------------------------

/**
 * 臨時休業・臨時営業を1件追加する。
 *
 * 重なりの事前チェックはUXのためのもので、最後の砦はDBのEXCLUDE制約
 * date_overrides_no_overlap(ADR-004と同じ方針)。同時操作では事前チェックを
 * すり抜けうるので、23P01 を捕まえて同じ文言に変換する。
 */
export async function addDateOverride(
  input: DateOverrideInput,
): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  try {
    const supabase = await createAdminAuthClient();

    // 「定休曜日を含む臨時営業は営業時間必須」の判定に毎週の定休曜日が要る。
    // 画面から渡された値ではなくDBの現在値で判定する(改ざん・古い画面への備え)。
    // 休業の登録ではこのルールが働かないので問い合わせ自体を省く
    let closedWeekdays: number[] = [];
    if (input.isOpen) {
      const hoursResult = await supabase
        .from("business_hours")
        .select("weekday, is_open");
      if (hoursResult.error !== null || hoursResult.data === null) {
        console.error("addDateOverride failed", hoursResult.error);
        return { ok: false, message: "営業時間の取得に失敗しました" };
      }
      const hours = hoursResult.data as Array<{
        weekday: number;
        is_open: boolean;
      }>;
      // business_hours に行が無い曜日も休業(closures.ts の判定と揃える)
      closedWeekdays = [0, 1, 2, 3, 4, 5, 6].filter(
        (weekday) =>
          hours.find((row) => row.weekday === weekday)?.is_open !== true,
      );
    }

    const validated = validateDateOverride({ input, closedWeekdays });
    if (!validated.ok) {
      const message =
        validated.errors.time ??
        validated.errors.endDate ??
        validated.errors.startDate ??
        "入力内容を確認してください";
      return { ok: false, message };
    }

    const existing = await fetchDateOverrides(supabase);
    if (findOverlappingOverride(validated.value, existing) !== null) {
      return { ok: false, message: DATE_OVERRIDE_OVERLAP_MESSAGE };
    }

    const { error } = await supabase.from("date_overrides").insert({
      start_date: validated.value.startDate,
      end_date: validated.value.endDate,
      is_open: validated.value.isOpen,
      label: validated.value.label,
      open_time: validated.value.openTime,
      close_time: validated.value.closeTime,
    });
    if (error !== null) {
      if (isDateRangeOverlapError(error)) {
        return { ok: false, message: DATE_OVERRIDE_OVERLAP_MESSAGE };
      }
      console.error("addDateOverride failed", error);
      return { ok: false, message: "臨時休業・指定日の登録に失敗しました" };
    }

    revalidateBusinessSettings();
    return { ok: true };
  } catch (error) {
    if (isDateRangeOverlapError(error)) {
      return { ok: false, message: DATE_OVERRIDE_OVERLAP_MESSAGE };
    }
    console.error("addDateOverride failed", error);
    return { ok: false, message: "臨時休業・指定日の登録に失敗しました" };
  }
}

/** 臨時休業・臨時営業を1件削除する(自動導出の祝日行は削除できない) */
export async function deleteDateOverride(
  id: string,
): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  if (!isUuid(id)) {
    return { ok: false, message: "削除対象が正しくありません" };
  }

  try {
    const supabase = await createAdminAuthClient();
    const { error } = await supabase
      .from("date_overrides")
      .delete()
      .eq("id", id);
    if (error !== null) {
      console.error("deleteDateOverride failed", error);
      return { ok: false, message: "臨時休業・指定日の削除に失敗しました" };
    }
    revalidateBusinessSettings();
    return { ok: true };
  } catch (error) {
    console.error("deleteDateOverride failed", error);
    return { ok: false, message: "臨時休業・指定日の削除に失敗しました" };
  }
}
