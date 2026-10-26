"use server";

// 管理画面(店側)のServer Action(配線に徹する。判断は src/lib/admin-login.ts)。
// - 認証は Supabase Auth のメール+パスワード(ADR-005)
// - 戻り値は判別可能なResult型でUIが分岐に迷わない形にする
// - セッションcookieの読み書きは createAdminAuthClient(@supabase/ssr)が行う

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  describeSlotAvailability,
  type ProxyDaySlot,
  type SlotAvailability,
} from "@/lib/admin-calendar";
import { describeLoginError, validateLoginInput } from "@/lib/admin-login";
import {
  isPastStart,
  isWallClockTime,
  validateProxyRegistration,
  validateReservationEdit,
  type ProxyRegistrationErrors,
  type ReservationEditErrors,
} from "@/lib/admin-reservation-form";
import type { BusinessDay } from "@/lib/availability";
import { isSlotTakenError, isUuid } from "@/lib/booking";
import { resolveBusinessDay, weeklyBusinessDayOf } from "@/lib/closures";
import { calendarWeekday, isCalendarDate, jstDateTime } from "@/lib/jst";
import { createAdminAuthClient } from "@/server/admin-auth";
import {
  fetchReservationDetail,
  searchCustomers,
  type CustomerSearchResult,
  type ReservationDetail,
} from "@/server/admin-data";
import { getDayAvailability } from "@/server/booking-data";
import { fetchBusinessCalendar } from "@/server/closure-data";

export type LoginResult = { ok: true } | { ok: false; message: string };

/** メール+パスワードでログインする。成功時はセッションcookieが設定される */
export async function login(
  email: unknown,
  password: unknown,
): Promise<LoginResult> {
  const input = validateLoginInput(email, password);
  if (!input.ok) {
    return { ok: false, message: input.message };
  }

  try {
    const supabase = await createAdminAuthClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error !== null) {
      return {
        ok: false,
        message: describeLoginError({ code: error.code, status: error.status }),
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("login failed", error);
    return {
      ok: false,
      message: "ログインに失敗しました。時間をおいて再度お試しください",
    };
  }
}

export type LogoutResult = { ok: true } | { ok: false; message: string };

/** ログアウトする。セッションcookieが削除される */
export async function logout(): Promise<LogoutResult> {
  try {
    const supabase = await createAdminAuthClient();
    const { error } = await supabase.auth.signOut();
    if (error !== null) {
      console.error("logout failed", error);
      return { ok: false, message: "ログアウトに失敗しました" };
    }
    return { ok: true };
  } catch (error) {
    console.error("logout failed", error);
    return { ok: false, message: "ログアウトに失敗しました" };
  }
}

// ---------------------------------------------------------------------------
// 代行登録(電話予約: モックD)
// - データ取得・RPCは authenticated クライアント(RLS適用)で行う。
//   ただし空き枠計算 getDayAvailability は read-only の共有可用性計算のため
//   例外的に再利用する(docs/milestone-4-plan.md「再利用する既存資産」)
// - 空き表示は補助であり、ダブルブッキング防止の本体はEXCLUDE制約(ADR-004)
// ---------------------------------------------------------------------------

export type SearchCustomersResult =
  | { ok: true; customers: CustomerSearchResult[] }
  | { ok: false; message: string };

/** 顧客検索(名前・電話の部分一致)。候補ドロップダウン用 */
export async function searchCustomersAction(
  query: unknown,
): Promise<SearchCustomersResult> {
  if (typeof query !== "string") {
    return { ok: false, message: "検索条件が正しくありません" };
  }
  try {
    const supabase = await createAdminAuthClient();
    const customers = await searchCustomers(supabase, query);
    return { ok: true, customers };
  } catch (error) {
    console.error("searchCustomers failed", error);
    return { ok: false, message: "顧客の検索に失敗しました" };
  }
}

export type CheckProxySlotInput = {
  staffId: string;
  date: string;
  time: string;
  menuIds: string[];
  /**
   * 変更モードで自分の旧予約を空き計算から除外する予約ID(省略時は従来動作)。
   * UPDATE方式の変更で、同じ枠のまま/近接時間へずらすと自分の予約が
   * 「埋まり」に見えてしまうのを防ぐ。
   */
  excludeReservationId?: string;
};

/**
 * 代行登録・店側変更フォームの空き表示(モックD)を返す。
 * 対象スタッフ・日付・時間・メニューが揃ったときに呼ぶ。
 * getDayAvailability(サーバーで所要時間を再計算)が返す枠の計算材料
 * (営業時間・勤務パターン・埋まり区間・ポリシー)を、純粋関数
 * describeSlotAvailability に渡して状態・理由・メッセージを導出する。
 * 変更モードでは excludeReservationId で自分の旧予約を空き計算から除く。
 */
export async function checkProxySlot(
  input: CheckProxySlotInput,
): Promise<SlotAvailability> {
  try {
    if (!isCalendarDate(input.date) || !isWallClockTime(input.time)) {
      return {
        status: "unavailable",
        canRegister: false,
        message: "日付・時間を選択してください",
      };
    }
    const now = new Date();
    const day = await getDayAvailability(
      input.date,
      input.menuIds,
      now,
      input.excludeReservationId,
    );
    if (day.kind === "invalid_menus") {
      return {
        status: "unavailable",
        canRegister: false,
        message: "メニューの指定が正しくありません",
      };
    }
    const context = day.perStaffContext.find(
      (candidate) => candidate.staffId === input.staffId,
    );
    return describeSlotAvailability({
      start: jstDateTime(input.date, input.time),
      durationMinutes: day.summary.totalDurationMinutes,
      businessDay: day.businessDay,
      // 定休日は登録不可(getDayAvailability が business_hours から判定)
      isClosedDay: day.isClosed,
      working: context?.working ?? null,
      busy: context?.busy ?? [],
      policy: day.policy,
      now,
      staffName: day.staff.find((member) => member.id === input.staffId)?.name,
    });
  } catch (error) {
    console.error("checkProxySlot failed", error);
    return {
      status: "unavailable",
      canRegister: false,
      message: "空き状況の取得に失敗しました",
    };
  }
}

export type GetProxyDaySlotsInput = {
  staffId: string;
  date: string;
  menuIds: string[];
  /** 変更モードで自分の旧予約を空き計算から除外する予約ID(checkProxySlot と同じ扱い) */
  excludeReservationId?: string;
};

export type GetProxyDaySlotsResult =
  | {
      ok: true;
      /** 対象スタッフ・対象日の開始時刻候補(空き・埋まりの両方を含む) */
      slots: ProxyDaySlot[];
      /** 対象日が定休日か(定休日は候補が空になる。文言の出し分け用) */
      isClosed: boolean;
    }
  | { ok: false; message: string };

/**
 * 代行登録・店側変更フォームの「その日の空き時間」一覧を返す。
 * 対象スタッフ・日付・メニューが揃ったときに呼ぶ(時間は不要)。
 * 客側 getAvailability と同じく getDayAvailability(サーバーで所要時間を再計算)の
 * perStaff から対象スタッフ分を取り出し、ISO文字列に直して返す。
 * これは「空いている時間の目安」であり、ダブルブッキング防止の本体は
 * EXCLUDE制約(ADR-004)。手入力での上書き登録は引き続き許す。
 */
export async function getProxyDaySlots(
  input: GetProxyDaySlotsInput,
): Promise<GetProxyDaySlotsResult> {
  try {
    if (!isCalendarDate(input.date)) {
      return { ok: false, message: "日付を選択してください" };
    }
    if (!isUuid(input.staffId)) {
      return { ok: false, message: "スタッフを選択してください" };
    }
    const day = await getDayAvailability(
      input.date,
      input.menuIds,
      new Date(),
      input.excludeReservationId,
    );
    if (day.kind === "invalid_menus") {
      return { ok: false, message: "メニューの指定が正しくありません" };
    }
    const entry = day.perStaff.find(
      (candidate) => candidate.staffId === input.staffId,
    );
    return {
      ok: true,
      isClosed: day.isClosed,
      slots: (entry?.slots ?? []).map((slot) => ({
        startISO: slot.start.toISOString(),
        status: slot.status,
      })),
    };
  } catch (error) {
    console.error("getProxyDaySlots failed", error);
    return { ok: false, message: "空き時間の取得に失敗しました" };
  }
}

export type CreateProxyReservationInput = {
  /** 既存顧客ID(選択済みなら)。新規客なら null */
  customerId: string | null;
  /** 新規客の名前(既存顧客選択時は無視される) */
  customerName: string;
  /** 新規客の電話(任意) */
  customerPhone: string;
  menuIds: string[];
  staffId: string;
  date: string;
  time: string;
  /**
   * ご要望・ご相談(任意)。客側の「ご要望・ご相談」と同じ reservations.note
   * (店内用のメモはスタッフメモ = customers.note。docs/milestone-4-plan.md の決定5)
   */
  note: string;
};

export type CreateProxyReservationResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "invalid_input"; errors: ProxyRegistrationErrors }
  // 開始が現在より過去(サーバーの now で判定。UIは時間フィールドにエラー表示)
  | { ok: false; reason: "past"; message: string }
  // 対象日が休業日(毎週の定休・第◯曜日・祝日・臨時休業。UIは日付フィールドに
  // エラー表示)
  | { ok: false; reason: "closed"; message: string }
  // その枠は埋まりました(EXCLUDE制約違反 23P01。UIは日時付近にエラー表示)
  | { ok: false; reason: "slot_taken"; message: string }
  // メニュー・顧客の指定不正(RPCの P0001)
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "server_error"; message: string };

/**
 * 対象日(JSTの暦日)の営業時間を確定する。
 * 休業日ルール(毎週の定休・第◯曜日・祝日・臨時休業)と臨時営業の営業時間を
 * 純粋関数 resolveBusinessDay(closures.ts)に渡すだけの配線。
 * 休業日は isOpen=false になり、時刻付きの臨時営業はその時刻で営業になる。
 */
async function resolveAdminBusinessDay(
  supabase: SupabaseClient,
  date: string,
): Promise<BusinessDay> {
  const { weeklyBusinessHours, closureRules } =
    await fetchBusinessCalendar(supabase);
  return resolveBusinessDay({
    date,
    weeklyBusinessDay: weeklyBusinessDayOf(
      weeklyBusinessHours,
      calendarWeekday(date),
    ),
    rules: closureRules,
  });
}

/**
 * 代行登録を確定する。
 * 入力検証(純粋)→ authenticated クライアントで admin_create_reservation RPC。
 * p_start はメニュー所要時間の合計からRPCが終了時刻を導出する(開始のみ渡す)。
 * エラー分岐は @supabase/supabase-js の error.code(SQLSTATE)で判別する:
 * - 23P01(exclusion_violation)= 事前チェック後に他の予約が入った → slot_taken
 * - P0001(RPCの raise)= 無効メニュー・顧客名未指定・無効な顧客ID → invalid
 */
export async function createProxyReservation(
  input: CreateProxyReservationInput,
): Promise<CreateProxyReservationResult> {
  const validated = validateProxyRegistration({
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    menuIds: input.menuIds,
    staffId: input.staffId,
    date: input.date,
    time: input.time,
  });
  if (!validated.ok) {
    return { ok: false, reason: "invalid_input", errors: validated.errors };
  }
  const value = validated.value;

  // 過去ガード(UXでなく本当のガード)。サーバーの now で判定し、RPC前に止める
  if (isPastStart(jstDateTime(value.date, value.time), new Date())) {
    return {
      ok: false,
      reason: "past",
      message: "過去の時間は登録できません",
    };
  }

  try {
    const supabase = await createAdminAuthClient();

    // 休業日ガード(UXでなく本当のガード)。対象日に営業時間が無ければRPC前に止める。
    // 判定は authenticated クライアントの休業日ルール + 純粋関数(closures.ts)。
    // 休憩・勤務時間外の上書きは許すが、休業日だけはブロックする(2026-07-18決定)。
    // 時刻付きの臨時営業の日は営業になるので、定休曜日でも代行登録できる
    const businessDay = await resolveAdminBusinessDay(supabase, value.date);
    if (!businessDay.isOpen) {
      return {
        ok: false,
        reason: "closed",
        message: "定休日は登録できません",
      };
    }

    const { data, error } = await supabase.rpc("admin_create_reservation", {
      p_customer_id: value.customerId,
      p_customer_name: value.customerName,
      p_customer_phone: value.customerPhone,
      p_staff_id: value.staffId,
      p_start: jstDateTime(value.date, value.time).toISOString(),
      p_menu_ids: value.menuIds,
      p_note: input.note === "" ? null : input.note,
    });

    if (error !== null) {
      // EXCLUDE制約違反(SQLSTATE 23P01)= 事前チェック後に他の予約が入った
      if (isSlotTakenError(error)) {
        return {
          ok: false,
          reason: "slot_taken",
          message: "その枠は埋まりました",
        };
      }
      // RPCが raise した業務エラー(無効メニュー・顧客名未指定・無効な顧客ID)
      if ((error as { code?: string }).code === "P0001") {
        return {
          ok: false,
          reason: "invalid",
          message: "メニューまたはお客様の指定が正しくありません",
        };
      }
      console.error("admin_create_reservation failed", error);
      return {
        ok: false,
        reason: "server_error",
        message: "予約の登録に失敗しました",
      };
    }

    if (typeof data !== "string") {
      console.error("admin_create_reservation returned unexpected value", data);
      return {
        ok: false,
        reason: "server_error",
        message: "予約の登録に失敗しました",
      };
    }
    return { ok: true, reservationId: data };
  } catch (error) {
    console.error("createProxyReservation failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "予約の登録に失敗しました",
    };
  }
}

// ---------------------------------------------------------------------------
// 店側変更(代行登録フォームを変更モードで再利用: モックC「変更」→モックD)
// - 顧客は固定(変更不可)。メニュー・スタッフ・日時・ご要望を編集できる
// - 確定は admin_update_reservation(UPDATE方式)。同じ予約を近接時間へずらしても
//   自己衝突しない。他予約と衝突したら23P01が伝搬しトランザクション全体ロールバック
//   (元予約は無傷)。ダブルブッキング防止の本体はEXCLUDE制約(ADR-004)
// ---------------------------------------------------------------------------

export type UpdateAdminReservationInput = {
  reservationId: string;
  staffId: string;
  date: string;
  time: string;
  menuIds: string[];
  /**
   * ご要望・ご相談(任意)。客側の「ご要望・ご相談」と同じ reservations.note
   * (店内用のメモはスタッフメモ = customers.note。docs/milestone-4-plan.md の決定5)
   */
  note: string;
};

export type UpdateAdminReservationResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input"; errors: ReservationEditErrors }
  // 開始が現在より過去(サーバーの now で判定。UIは時間フィールドにエラー表示)
  | { ok: false; reason: "past"; message: string }
  // 対象日が休業日(毎週の定休・第◯曜日・祝日・臨時休業。UIは日付フィールドに
  // エラー表示)
  | { ok: false; reason: "closed"; message: string }
  // 対象が booking かつ confirmed でない(既に取り消し済み等)
  | { ok: false; reason: "not_found"; message: string }
  // その枠は埋まりました(EXCLUDE制約違反 23P01。元予約は無傷でロールバック)
  | { ok: false; reason: "slot_taken"; message: string }
  // メニューの指定不正(RPCの P0001)
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "server_error"; message: string };

/**
 * 店側変更を確定する。
 * 入力検証(純粋・顧客は対象外)→ authenticated クライアントで
 * admin_update_reservation RPC。返り値 'ok' | 'not_found' と
 * SQLSTATE(23P01=slot_taken / P0001=invalid)で分岐する。
 */
export async function updateAdminReservation(
  input: UpdateAdminReservationInput,
): Promise<UpdateAdminReservationResult> {
  if (typeof input.reservationId !== "string" || !isUuid(input.reservationId)) {
    return {
      ok: false,
      reason: "not_found",
      message: "予約が見つかりませんでした",
    };
  }

  const validated = validateReservationEdit({
    menuIds: input.menuIds,
    staffId: input.staffId,
    date: input.date,
    time: input.time,
  });
  if (!validated.ok) {
    return { ok: false, reason: "invalid_input", errors: validated.errors };
  }
  const value = validated.value;

  // 過去ガード(UXでなく本当のガード)。サーバーの now で判定し、RPC前に止める
  if (isPastStart(jstDateTime(value.date, value.time), new Date())) {
    return {
      ok: false,
      reason: "past",
      message: "過去の時間は登録できません",
    };
  }

  try {
    const supabase = await createAdminAuthClient();

    // 休業日ガード(UXでなく本当のガード)。対象日に営業時間が無ければRPC前に止める。
    // 判定は authenticated クライアントの休業日ルール + 純粋関数(closures.ts)。
    // 休憩・勤務時間外の上書きは許すが、休業日だけはブロックする(2026-07-18決定)。
    // 時刻付きの臨時営業の日は営業になるので、定休曜日でも代行登録できる
    const businessDay = await resolveAdminBusinessDay(supabase, value.date);
    if (!businessDay.isOpen) {
      return {
        ok: false,
        reason: "closed",
        message: "定休日は登録できません",
      };
    }

    const { data, error } = await supabase.rpc("admin_update_reservation", {
      p_reservation_id: input.reservationId,
      p_staff_id: value.staffId,
      p_start: jstDateTime(value.date, value.time).toISOString(),
      p_menu_ids: value.menuIds,
      p_note: input.note === "" ? null : input.note,
    });

    if (error !== null) {
      // EXCLUDE制約違反(SQLSTATE 23P01)= 事前チェック後に他の予約が入った。
      // UPDATE方式なので自己衝突はせず、全体ロールバックで元予約は無傷
      if (isSlotTakenError(error)) {
        return {
          ok: false,
          reason: "slot_taken",
          message: "その枠は埋まりました",
        };
      }
      // RPCが raise した業務エラー(無効メニュー)
      if ((error as { code?: string }).code === "P0001") {
        return {
          ok: false,
          reason: "invalid",
          message: "メニューの指定が正しくありません",
        };
      }
      console.error("admin_update_reservation failed", error);
      return {
        ok: false,
        reason: "server_error",
        message: "予約の変更に失敗しました",
      };
    }

    if (data === "ok") {
      return { ok: true };
    }
    if (data === "not_found") {
      return {
        ok: false,
        reason: "not_found",
        message: "この予約は既に取り消されています",
      };
    }
    console.error("admin_update_reservation returned unexpected value", data);
    return {
      ok: false,
      reason: "server_error",
      message: "予約の変更に失敗しました",
    };
  } catch (error) {
    console.error("updateAdminReservation failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "予約の変更に失敗しました",
    };
  }
}

// ---------------------------------------------------------------------------
// 予約詳細ダイアログ(モックC): 詳細取得・店側キャンセル・スタッフメモ編集
// - いずれも authenticated クライアント(RLS適用)。service_role は使わない
// - キャンセルは単文UPDATE(RPC不要)。締切(cancel_deadline_minutes)は
//   客側専用の制約なので店側キャンセルには適用しない(2026-07-17決定)
// ---------------------------------------------------------------------------

export type GetReservationDetailResult =
  { ok: true; detail: ReservationDetail } | { ok: false; message: string };

/**
 * 予約詳細を取得する(カレンダーの予約カードクリックで開く)。
 * detail は Date を含むが、RSC/Action境界を越えて client へ渡せる。
 */
export async function getReservationDetailAction(
  id: string,
): Promise<GetReservationDetailResult> {
  if (typeof id !== "string" || !isUuid(id)) {
    return { ok: false, message: "予約が見つかりませんでした" };
  }
  try {
    const supabase = await createAdminAuthClient();
    const detail = await fetchReservationDetail(supabase, id);
    if (detail === null) {
      return { ok: false, message: "予約が見つかりませんでした" };
    }
    return { ok: true, detail };
  } catch (error) {
    console.error("getReservationDetail failed", error);
    return { ok: false, message: "予約の取得に失敗しました" };
  }
}

export type CancelByAdminResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "server_error"; message: string };

/**
 * 店側キャンセル。authenticated クライアントで単文UPDATE
 * (status='cancelled', cancelled_at=now())。対象は kind='booking' かつ
 * status='confirmed' のみ。更新0件なら既にキャンセル済み等として not_found。
 * confirmed から外れるとEXCLUDE制約(ADR-004)の対象から外れ、枠が空きに戻る。
 * 更新件数は @supabase/supabase-js の update().select() が返す行数で判定する。
 */
export async function cancelReservationByAdmin(
  id: string,
): Promise<CancelByAdminResult> {
  if (typeof id !== "string" || !isUuid(id)) {
    return {
      ok: false,
      reason: "not_found",
      message: "予約が見つかりませんでした",
    };
  }
  try {
    const supabase = await createAdminAuthClient();
    const { data, error } = await supabase
      .from("reservations")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", id)
      .eq("kind", "booking")
      .eq("status", "confirmed")
      .select("id");
    if (error !== null) {
      console.error("cancelReservationByAdmin failed", error);
      return {
        ok: false,
        reason: "server_error",
        message: "キャンセルに失敗しました",
      };
    }
    if (data === null || data.length === 0) {
      return {
        ok: false,
        reason: "not_found",
        message: "この予約は既に取り消されています",
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("cancelReservationByAdmin failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "キャンセルに失敗しました",
    };
  }
}

export type UpdateStaffMemoResult =
  { ok: true } | { ok: false; message: string };

/**
 * スタッフメモ(顧客単位の店内メモ = customers.note)を更新する。
 * 前後空白を除き、空文字は NULL にする(唯一の入力箇所: 2026-07-17決定)。
 */
export async function updateStaffMemo(
  customerId: string,
  memo: string,
): Promise<UpdateStaffMemoResult> {
  if (typeof customerId !== "string" || !isUuid(customerId)) {
    return { ok: false, message: "お客様が見つかりませんでした" };
  }
  const trimmed = typeof memo === "string" ? memo.trim() : "";
  try {
    const supabase = await createAdminAuthClient();
    // 更新できた行数を確かめる。存在しないID・RLSで見えない行でも
    // PostgRESTのUPDATEはエラーにならず0行で成功するため、確かめないと
    // メモが保存されていないのに保存できたように見える
    const { data, error } = await supabase
      .from("customers")
      .update({ note: trimmed === "" ? null : trimmed })
      .eq("id", customerId)
      .select("id");
    if (error !== null) {
      console.error("updateStaffMemo failed", error);
      return { ok: false, message: "メモの保存に失敗しました" };
    }
    if (data === null || data.length === 0) {
      return { ok: false, message: "お客様が見つかりませんでした" };
    }
    return { ok: true };
  } catch (error) {
    console.error("updateStaffMemo failed", error);
    return { ok: false, message: "メモの保存に失敗しました" };
  }
}
