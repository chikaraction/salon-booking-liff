"use server";

// 管理画面(店側)のServer Action(配線に徹する。判断は src/lib/admin-login.ts)。
// - 認証は Supabase Auth のメール+パスワード(ADR-005)
// - 戻り値は判別可能なResult型でUIが分岐に迷わない形にする
// - セッションcookieの読み書きは createAdminAuthClient(@supabase/ssr)が行う

import {
  slotAvailabilityMessage,
  type SlotAvailability,
} from "@/lib/admin-calendar";
import { describeLoginError, validateLoginInput } from "@/lib/admin-login";
import {
  isWallClockTime,
  validateProxyRegistration,
  type ProxyRegistrationErrors,
} from "@/lib/admin-reservation-form";
import { isCalendarDate, jstDateTime } from "@/lib/availability";
import { isSlotTakenError } from "@/lib/booking";
import { createAdminAuthClient } from "@/server/admin-auth";
import {
  searchCustomers,
  type CustomerSearchResult,
} from "@/server/admin-data";
import { getDayAvailability } from "@/server/booking-data";

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
};

/**
 * 代行登録フォームの空き表示(モックD)を返す。
 * 対象スタッフ・日付・時間・メニューが揃ったときに呼ぶ。
 * getDayAvailability(サーバーで所要時間を再計算)の対象スタッフの枠から、
 * 純粋関数 slotAvailabilityMessage が2状態のメッセージを導出する。
 */
export async function checkProxySlot(
  input: CheckProxySlotInput,
): Promise<SlotAvailability> {
  try {
    if (!isCalendarDate(input.date) || !isWallClockTime(input.time)) {
      return { available: false, message: "この枠は埋まっています" };
    }
    const day = await getDayAvailability(input.date, input.menuIds, new Date());
    if (day.kind === "invalid_menus") {
      return {
        available: false,
        message: "メニューの指定が正しくありません",
      };
    }
    const entry = day.perStaff.find(
      (candidate) => candidate.staffId === input.staffId,
    );
    return slotAvailabilityMessage({
      slots: entry?.slots ?? [],
      start: jstDateTime(input.date, input.time),
      totalDurationMinutes: day.summary.totalDurationMinutes,
    });
  } catch (error) {
    console.error("checkProxySlot failed", error);
    return { available: false, message: "空き状況の取得に失敗しました" };
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
  /** メモ(任意・店内用) */
  note: string;
};

export type CreateProxyReservationResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "invalid_input"; errors: ProxyRegistrationErrors }
  // その枠は埋まりました(EXCLUDE制約違反 23P01。UIは日時付近にエラー表示)
  | { ok: false; reason: "slot_taken"; message: string }
  // メニュー・顧客の指定不正(RPCの P0001)
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "server_error"; message: string };

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

  try {
    const supabase = await createAdminAuthClient();
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
