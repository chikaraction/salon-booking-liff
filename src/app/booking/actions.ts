"use server";

// 客側予約フローのServer Action(配線に徹する。判断は src/lib/ の純粋関数)。
// - 所要時間・空き枠は必ずサーバーでメニューIDから再計算する
//   (クライアント申告を信用しない)
// - ここでの空きチェックはUX向上のための事前チェックであり、
//   ダブルブッキング防止の本体はDBのEXCLUDE制約(ADR-004)
// - 認証はLINE IDトークンのサーバー側検証のみを信頼する(ADR-003)
// - 戻り値はすべて判別可能なResult型(ok + reason)でUIが分岐に迷わない形にする

import {
  isCalendarDate,
  jstCalendarDate,
  mergeStaffSlots,
  pickStaffForStart,
  type Slot,
  type SlotStatus,
} from "@/lib/availability";
import {
  isSlotTakenError,
  validateCustomerInfo,
  type CustomerInfoErrors,
} from "@/lib/booking";
import {
  findCustomerByLineUserId,
  getDayAvailability,
} from "@/server/booking-data";
import { verifyLineIdToken } from "@/server/line";
import { getServiceRoleClient } from "@/server/supabase";

const MINUTE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// 空き枠取得
// ---------------------------------------------------------------------------

/** スタッフ選択: スタッフID(uuid)または "any"(どちらでも) */
export type StaffSelection = string;

export type AvailabilitySlot = {
  /** 開始時刻(UTCのISO文字列) */
  startISO: string;
  status: SlotStatus;
};

export type GetAvailabilityResult =
  | { ok: true; slots: AvailabilitySlot[] }
  | { ok: false; reason: "invalid_input"; message: string }
  | { ok: false; reason: "server_error"; message: string };

/**
 * 対象日(JSTの暦日)の開始時刻候補を返す。
 * "any" は全スタッフの和集合(いずれかが空いていれば空き)。
 */
export async function getAvailability(
  dateISO: string,
  menuIds: string[],
  staffSelection: StaffSelection,
): Promise<GetAvailabilityResult> {
  try {
    if (!isCalendarDate(dateISO)) {
      return {
        ok: false,
        reason: "invalid_input",
        message: "日付の形式が正しくありません",
      };
    }

    const day = await getDayAvailability(dateISO, menuIds, new Date());
    if (day.kind === "invalid_menus") {
      return {
        ok: false,
        reason: "invalid_input",
        message: "メニューの指定が正しくありません",
      };
    }

    let slots: Slot[];
    if (staffSelection === "any") {
      slots = mergeStaffSlots(day.perStaff.map((entry) => entry.slots));
    } else {
      const entry = day.perStaff.find(
        (candidate) => candidate.staffId === staffSelection,
      );
      if (!entry) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "スタッフの指定が正しくありません",
        };
      }
      slots = entry.slots;
    }

    return {
      ok: true,
      slots: slots.map((slot) => ({
        startISO: slot.start.toISOString(),
        status: slot.status,
      })),
    };
  } catch (error) {
    console.error("getAvailability failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "空き状況の取得に失敗しました",
    };
  }
}

// ---------------------------------------------------------------------------
// 顧客の確認(初回情報入力ステップの出し分け用)
// ---------------------------------------------------------------------------

export type CheckCustomerResult =
  | { ok: true; isNew: boolean; name?: string }
  | { ok: false; reason: "auth"; message: string }
  | { ok: false; reason: "server_error"; message: string };

/** IDトークンを検証し、登録済み顧客かどうかを返す */
export async function checkCustomer(
  idToken: string,
): Promise<CheckCustomerResult> {
  try {
    const verified = await verifyLineIdToken(idToken);
    if (!verified.ok) {
      return { ok: false, reason: "auth", message: verified.message };
    }

    const customer = await findCustomerByLineUserId(verified.userId);
    if (customer === null) {
      return { ok: true, isNew: true };
    }
    return { ok: true, isNew: false, name: customer.name };
  } catch (error) {
    console.error("checkCustomer failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "顧客情報の確認に失敗しました",
    };
  }
}

// ---------------------------------------------------------------------------
// 予約の確定
// ---------------------------------------------------------------------------

export type SubmitReservationInput = {
  idToken: string;
  /** スタッフID(uuid)または "any"(どちらでも) */
  staffSelection: StaffSelection;
  /** 開始時刻(UTCのISO文字列。空き枠取得の startISO をそのまま渡す) */
  startISO: string;
  menuIds: string[];
  /** ご要望・ご相談(任意) */
  note?: string;
  /** 初回のみ必須(登録済み顧客では無視される) */
  customerInfo?: { name: string; phone: string };
};

export type SubmitReservationResult =
  | {
      ok: true;
      reservation: {
        id: string;
        startISO: string;
        endISO: string;
        staffId: string;
        staffName: string;
        totalPrice: number;
        totalDurationMinutes: number;
      };
    }
  | { ok: false; reason: "auth"; message: string }
  | { ok: false; reason: "invalid_customer_info"; errors: CustomerInfoErrors }
  | { ok: false; reason: "invalid_input"; message: string }
  // その枠は埋まりました(UIは日時選択に戻す)
  | { ok: false; reason: "slot_taken" }
  | { ok: false; reason: "server_error"; message: string };

/** 予約を確定する */
export async function submitReservation(
  input: SubmitReservationInput,
): Promise<SubmitReservationResult> {
  try {
    // a. 認証(LINE IDトークンのサーバー側検証のみを信頼する)
    const verified = await verifyLineIdToken(input.idToken);
    if (!verified.ok) {
      return { ok: false, reason: "auth", message: verified.message };
    }

    // b. 初回のみ顧客情報を検証(未入力は「空で入力された」として全項目エラーにする)
    const customer = await findCustomerByLineUserId(verified.userId);
    let newCustomer: { name: string; phone: string } | null = null;
    if (customer === null) {
      const validated = validateCustomerInfo(
        input.customerInfo ?? { name: "", phone: "" },
      );
      if (!validated.ok) {
        return {
          ok: false,
          reason: "invalid_customer_info",
          errors: validated.errors,
        };
      }
      newCustomer = validated.value;
    }

    const start = new Date(input.startISO);
    if (Number.isNaN(start.getTime())) {
      return {
        ok: false,
        reason: "invalid_input",
        message: "開始時刻の形式が正しくありません",
      };
    }

    // c. 空き枠をサーバーで再計算し、指定の開始時刻が空きであることを確認
    //    (UX向上のための事前チェック。最後の砦はEXCLUDE制約: ADR-004)
    const day = await getDayAvailability(
      jstCalendarDate(start),
      input.menuIds,
      new Date(),
    );
    if (day.kind === "invalid_menus") {
      return {
        ok: false,
        reason: "invalid_input",
        message: "メニューの指定が正しくありません",
      };
    }

    let staffId: string | null;
    if (input.staffSelection === "any") {
      // perStaff は display_order 順なので、空いている中で先頭のスタッフに
      // 決定的に割り当てる(実質オーナー優先)
      staffId = pickStaffForStart(day.perStaff, start);
    } else {
      const entry = day.perStaff.find(
        (candidate) => candidate.staffId === input.staffSelection,
      );
      if (!entry) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "スタッフの指定が正しくありません",
        };
      }
      staffId = pickStaffForStart([entry], start);
    }
    if (staffId === null) {
      return { ok: false, reason: "slot_taken" };
    }

    // d. RPCで予約作成(顧客の作成/特定〜メニュースナップショットまでアトミック。
    //    時間範囲はRPCがメニュー所要時間の合計から導出する)
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase.rpc("create_reservation", {
      p_line_user_id: verified.userId,
      p_customer_name: newCustomer?.name ?? null,
      p_customer_phone: newCustomer?.phone ?? null,
      p_staff_id: staffId,
      p_start: start.toISOString(),
      p_menu_ids: [...new Set(input.menuIds)],
      p_note: input.note ?? null,
    });
    if (error !== null) {
      // EXCLUDE制約違反(SQLSTATE 23P01)= 事前チェック後に他の予約が入った
      if (isSlotTakenError(error)) {
        return { ok: false, reason: "slot_taken" };
      }
      console.error("create_reservation failed", error);
      return {
        ok: false,
        reason: "server_error",
        message: "予約の作成に失敗しました",
      };
    }
    if (typeof data !== "string") {
      console.error("create_reservation returned unexpected value", data);
      return {
        ok: false,
        reason: "server_error",
        message: "予約の作成に失敗しました",
      };
    }

    // e. 完了画面の表示に必要な情報を返す
    const staffName =
      day.staff.find((member) => member.id === staffId)?.name ?? "";
    const end = new Date(
      start.getTime() + day.summary.totalDurationMinutes * MINUTE_MS,
    );
    return {
      ok: true,
      reservation: {
        id: data,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        staffId,
        staffName,
        totalPrice: day.summary.totalPrice,
        totalDurationMinutes: day.summary.totalDurationMinutes,
      },
    };
  } catch (error) {
    console.error("submitReservation failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "予約の作成に失敗しました",
    };
  }
}
