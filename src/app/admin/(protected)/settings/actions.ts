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

import { isStaffRole } from "@/lib/admin-permissions";
import { calendarWeekday, isCalendarDate } from "@/lib/availability";
import { isUuid } from "@/lib/booking";
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
import { resolveBusinessDay, resolveStaffWorkingDay } from "@/lib/closures";
import {
  BLOCK_CONFLICT_MESSAGE,
  diffStaffWorkingHours,
  findLastOwnerViolation,
  isBlockConflictError,
  resolveStaffBlockRange,
  validateStaffInput,
  validateStaffWorkingHours,
  type StaffBlockInput,
  type StaffInput,
  type WorkingDayInput,
} from "@/lib/staff-settings";
import { formatTstzrange } from "@/lib/tstzrange";
import {
  fetchAdminBusinessHours,
  fetchClosureRules,
  fetchStaffWorkingHoursForWeekday,
} from "@/server/admin-data";
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
// ---------------------------------------------------------------------------
// スタッフ設定(モックE)
// ---------------------------------------------------------------------------
//
// 【権限の非対称に注意】
// staff / staff_working_hours はRLSでもオーナーのみ変更できる(M4bのRLS分割)。
// これに対し reservations(臨時休ブロックが入るテーブル)は、スタッフも
// 代行登録・代行キャンセルを行うため authenticated 全操作可のままである
// (ADR-005)。つまり臨時休ブロックの追加・削除はRLSでは守られておらず、
// アプリ層の requireOwner() だけが効いている。ここのガードを外すと
// スタッフが他人の臨時休を作れる・消せるようになる。

/** スタッフ設定画面のパス(保存後の再検証に使う) */
const STAFF_SETTINGS_PATH = "/admin/settings/staff";

/**
 * スタッフ・勤務パターン・臨時休はいずれも管理画面カレンダーの表示
 * (担当者の列・ブロックの帯)と客側の枠計算に効くので、設定画面だけでなく
 * 管理画面のカレンダーも再検証する。
 */
function revalidateStaffSettings(): void {
  revalidatePath(STAFF_SETTINGS_PATH);
  revalidatePath("/admin");
}

/**
 * スタッフを1件追加・更新する(id が null なら追加)。
 *
 * 物理削除は提供しない。reservations.staff_id が staff を参照しており
 * (ON DELETE 指定なし)、過去の予約があるスタッフは外部キー違反で消せず、
 * 消せてしまう場合も来店履歴が壊れる。運用上の「やめたスタッフ」は
 * is_active = false で表す(枠計算・指名候補から外れる)。
 *
 * auth_user_id はこのアクションでは触らない。管理画面ユーザーの作成は
 * Supabaseダッシュボード、staff への紐付けはSQLで行う運用
 * (README「店側スタッフ(管理画面ユーザー)の登録」)。
 */
export async function saveStaff(params: {
  id: string | null;
  input: StaffInput;
}): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  const { id, input } = params;
  if (id !== null && !isUuid(id)) {
    return { ok: false, message: "保存対象が正しくありません" };
  }

  const validated = validateStaffInput(input);
  if (!validated.ok) {
    const message =
      validated.errors.name ??
      validated.errors.role ??
      validated.errors.displayOrder ??
      validated.message;
    return { ok: false, message };
  }

  try {
    const supabase = await createAdminAuthClient();

    // 「有効なオーナーが1人もいなくなる変更」の判定は、画面から渡された一覧では
    // なくDBの現在値で行う(改ざん・古い画面への備え)
    const staffResult = await supabase
      .from("staff")
      .select("id, role, is_active");
    if (staffResult.error !== null || staffResult.data === null) {
      console.error("saveStaff failed", staffResult.error);
      return { ok: false, message: "スタッフの取得に失敗しました" };
    }
    const staffList = (
      staffResult.data as Array<{
        id: string;
        role: string;
        is_active: boolean;
      }>
    ).map((row) => ({
      id: row.id,
      role: isStaffRole(row.role) ? row.role : ("staff" as const),
      isActive: row.is_active,
    }));

    const violation = findLastOwnerViolation({
      staffList,
      target: {
        id,
        role: validated.value.role,
        isActive: validated.value.isActive,
      },
    });
    if (violation !== null) {
      return { ok: false, message: violation };
    }

    const row = {
      name: validated.value.name,
      role: validated.value.role,
      display_order: validated.value.displayOrder,
      is_active: validated.value.isActive,
      bio: validated.value.bio,
    };

    const { error } =
      id === null
        ? await supabase.from("staff").insert(row)
        : await supabase.from("staff").update(row).eq("id", id);
    if (error !== null) {
      console.error("saveStaff failed", error);
      return { ok: false, message: "スタッフの保存に失敗しました" };
    }

    revalidateStaffSettings();
    return { ok: true };
  } catch (error) {
    console.error("saveStaff failed", error);
    return { ok: false, message: "スタッフの保存に失敗しました" };
  }
}

/**
 * スタッフの週次勤務パターンを保存する。
 * 曜日チップのON/OFFを (staff_id, weekday) の行のupsert/deleteに振り分けるのは
 * 純粋関数(diffStaffWorkingHours)。検証はDB制約 staff_working_hours_* と
 * 同じルールを先出しするもので、最後の砦はDB制約。
 */
export async function saveStaffWorkingHours(params: {
  staffId: string;
  days: WorkingDayInput[];
}): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  const { staffId, days } = params;
  if (!isUuid(staffId)) {
    return { ok: false, message: "保存対象が正しくありません" };
  }

  const validated = validateStaffWorkingHours(days);
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }
  const diff = diffStaffWorkingHours(validated.value);

  try {
    const supabase = await createAdminAuthClient();

    if (diff.upserts.length > 0) {
      const upsertResult = await supabase.from("staff_working_hours").upsert(
        diff.upserts.map((day) => ({
          staff_id: staffId,
          weekday: day.weekday,
          start_time: day.startTime,
          end_time: day.endTime,
          break_start: day.breakStart,
          break_end: day.breakEnd,
        })),
        { onConflict: "staff_id,weekday" },
      );
      if (upsertResult.error !== null) {
        console.error("saveStaffWorkingHours failed", upsertResult.error);
        return { ok: false, message: "勤務時間の保存に失敗しました" };
      }
    }

    if (diff.deleteWeekdays.length > 0) {
      // 休みにした曜日の行を消す(元から行が無ければ0行削除で何も起きない)
      const deleteResult = await supabase
        .from("staff_working_hours")
        .delete()
        .eq("staff_id", staffId)
        .in("weekday", diff.deleteWeekdays);
      if (deleteResult.error !== null) {
        console.error("saveStaffWorkingHours failed", deleteResult.error);
        return { ok: false, message: "勤務時間の保存に失敗しました" };
      }
    }

    revalidateStaffSettings();
    return { ok: true };
  } catch (error) {
    console.error("saveStaffWorkingHours failed", error);
    return { ok: false, message: "勤務時間の保存に失敗しました" };
  }
}

/**
 * 臨時休ブロックを1件追加する(reservations の kind='block' 行)。
 *
 * 「終日」の時間帯はその日の実効勤務時間から求める。実効勤務時間は
 * closures.ts の resolveBusinessDay / resolveStaffWorkingDay を通した結果で、
 * 客側の枠計算・管理画面カレンダーと同じ判定を使う(定休曜日の臨時営業日にも
 * 同じ意味で効く)。その日にもともと勤務が無ければ終日は算出できないので
 * エラーにする(純粋関数側の判断)。
 *
 * 既存の予約と重なるブロックはEXCLUDE制約 reservations_no_overlap が
 * 23P01 で拒否する。これがダブルブッキング防止の本体であり、
 * 外す・迂回することは禁止(ADR-004)。ここでは文言に変換するだけにして、
 * アプリ側の事前チェックは置いていない(同時操作ではどのみちすり抜けるため、
 * 同じ判定を二重に持たない)。
 */
export async function addStaffBlock(params: {
  staffId: string;
  input: StaffBlockInput;
}): Promise<SettingsActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, message: guard.message };

  const { staffId, input } = params;
  if (!isUuid(staffId)) {
    return { ok: false, message: "登録対象が正しくありません" };
  }
  // その日の勤務パターンを引くのに曜日が要るので、日付だけ先に確かめる
  // (時間帯そのものの検証は resolveStaffBlockRange が行う)
  if (!isCalendarDate(input.date)) {
    return { ok: false, message: "日付を選択してください" };
  }

  try {
    const supabase = await createAdminAuthClient();
    const weekday = calendarWeekday(input.date);

    const businessHours = await fetchAdminBusinessHours(supabase);
    const [rules, workingRows] = await Promise.all([
      fetchClosureRules(supabase, businessHours),
      fetchStaffWorkingHoursForWeekday(supabase, weekday),
    ]);

    // business_hours に行が無い曜日は休業(closures.ts の判定と揃える)
    const weeklyBusinessDay = businessHours.find(
      (day) => day.weekday === weekday,
    ) ?? { isOpen: false, openTime: null, closeTime: null };
    const businessDay = resolveBusinessDay({
      date: input.date,
      weeklyBusinessDay,
      rules,
    });
    const weeklyWorking =
      workingRows.find((row) => row.staffId === staffId) ?? null;
    const workingDay = resolveStaffWorkingDay({
      date: input.date,
      weeklyWorking,
      weeklyBusinessDay,
      businessDay,
    });

    const range = resolveStaffBlockRange({ input, workingDay });
    if (!range.ok) {
      const message =
        range.errors.time ?? range.errors.date ?? "入力内容を確認してください";
      return { ok: false, message };
    }

    const { error } = await supabase.from("reservations").insert({
      kind: "block",
      source: "admin",
      status: "confirmed",
      staff_id: staffId,
      during: formatTstzrange(range.value.start, range.value.end),
    });
    if (error !== null) {
      if (isBlockConflictError(error)) {
        return { ok: false, message: BLOCK_CONFLICT_MESSAGE };
      }
      console.error("addStaffBlock failed", error);
      return { ok: false, message: "臨時休の登録に失敗しました" };
    }

    revalidateStaffSettings();
    return { ok: true };
  } catch (error) {
    if (isBlockConflictError(error)) {
      return { ok: false, message: BLOCK_CONFLICT_MESSAGE };
    }
    console.error("addStaffBlock failed", error);
    return { ok: false, message: "臨時休の登録に失敗しました" };
  }
}

/**
 * 臨時休ブロックを1件削除する。
 *
 * kind = 'block' を必ず条件に入れる。reservations には客の予約(kind='booking')
 * も入っており、IDだけで消せる経路を作ると予約を誤って物理削除できてしまう
 * (予約のキャンセルは status='cancelled' への更新で、履歴として残す)。
 *
 * ブロックの側を物理削除にしているのは、臨時休には履歴的価値が無いため。
 * 「いつ臨時休にしていたか」を後から参照する要件はなく、行を残す方式にすると
 * EXCLUDE制約の対象(status='confirmed')から外すための状態管理が増える。
 */
export async function deleteStaffBlock(
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
      .from("reservations")
      .delete()
      .eq("id", id)
      .eq("kind", "block");
    if (error !== null) {
      console.error("deleteStaffBlock failed", error);
      return { ok: false, message: "臨時休の削除に失敗しました" };
    }
    revalidateStaffSettings();
    return { ok: true };
  } catch (error) {
    console.error("deleteStaffBlock failed", error);
    return { ok: false, message: "臨時休の削除に失敗しました" };
  }
}
