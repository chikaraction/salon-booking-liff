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
  formatJstDateTimeLabel,
  isReservationLimitError,
  isSlotTakenError,
  isUuid,
  parseChangeReservationResult,
  validateCustomerInfo,
  type CustomerInfoErrors,
} from "@/lib/booking";
import {
  findCustomerByLineUserId,
  findOwnConfirmedBooking,
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

/** 変更モード(M3)の文脈。指定時は本人確認のうえ旧予約を空き計算から除外する */
export type ChangeContext = {
  idToken: string;
  reservationId: string;
};

/**
 * 対象日(JSTの暦日)の開始時刻候補を返す。
 * "any" は全スタッフの和集合(いずれかが空いていれば空き)。
 * changeContext を指定すると、その予約が本人のものであることを確認したうえで
 * 空き計算から除外する(変更フローで自分の旧枠を空きとして見せるため)。
 * 本人のものと確認できない場合は除外せず通常計算する(エラーにはしない)。
 */
export async function getAvailability(
  dateISO: string,
  menuIds: string[],
  staffSelection: StaffSelection,
  changeContext?: ChangeContext,
): Promise<GetAvailabilityResult> {
  try {
    if (!isCalendarDate(dateISO)) {
      return {
        ok: false,
        reason: "invalid_input",
        message: "日付の形式が正しくありません",
      };
    }

    let excludeReservationId: string | undefined;
    if (changeContext !== undefined && isUuid(changeContext.reservationId)) {
      const verified = await verifyLineIdToken(changeContext.idToken);
      if (verified.ok) {
        const own = await findOwnConfirmedBooking(
          verified.userId,
          changeContext.reservationId,
        );
        if (own !== null) {
          excludeReservationId = own.id;
        }
      }
    }

    const day = await getDayAvailability(
      dateISO,
      menuIds,
      new Date(),
      excludeReservationId,
    );
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
// 変更元予約の取得(M3: ウィザードの変更モードの初期値用)
// ---------------------------------------------------------------------------

export type ChangeSource = {
  reservationId: string;
  /** 予約時のメニューID(元メニュー削除でnullになったスナップショットは除く) */
  menuIds: string[];
  staffId: string;
  note: string;
  /** 変更元の開始時刻(UTCのISO文字列) */
  startISO: string;
  /** 変更元の日時表示(例: 7月18日(土)11:00〜) */
  dateTimeLabel: string;
};

export type GetChangeSourceResult =
  | { ok: true; source: ChangeSource }
  | { ok: false; reason: "auth"; message: string }
  // 存在しない・他人の予約・キャンセル済み(UIは「この予約は変更できません」)
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "server_error"; message: string };

/**
 * 変更元の予約を取得する(変更モードのウィザード初期値用)。
 * 本人所有・confirmed・kind=booking の予約のみ返す。本人確認は必ずサーバーで行う
 * (customers.line_user_id との照合。他人・不存在・キャンセル済みは not_found)。
 */
export async function getChangeSource(
  idToken: string,
  reservationId: string,
): Promise<GetChangeSourceResult> {
  try {
    const verified = await verifyLineIdToken(idToken);
    if (!verified.ok) {
      return { ok: false, reason: "auth", message: verified.message };
    }

    // URL由来の値なのでUUID形式を先に確認する(不正な形式は存在しないのと同じ扱い)
    if (!isUuid(reservationId)) {
      return { ok: false, reason: "not_found" };
    }

    const reservation = await findOwnConfirmedBooking(
      verified.userId,
      reservationId,
    );
    if (reservation === null) {
      return { ok: false, reason: "not_found" };
    }

    return {
      ok: true,
      source: {
        reservationId: reservation.id,
        menuIds: reservation.menuIds,
        staffId: reservation.staffId,
        note: reservation.note ?? "",
        startISO: reservation.start.toISOString(),
        dateTimeLabel: formatJstDateTimeLabel(reservation.start),
      },
    };
  } catch (error) {
    console.error("getChangeSource failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "変更元の予約の取得に失敗しました",
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
  /**
   * 変更モード(M3): 変更元の予約ID。指定時は create_reservation の代わりに
   * change_reservation RPC で「旧キャンセル+新規作成」をアトミックに行う
   */
  changeReservationId?: string;
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
  // 変更元予約が見つからない(取り消し済み・他人の予約。UIはマイ予約へ誘導する)
  | { ok: false; reason: "change_source_gone" }
  // 変更締切超過(UIは「直前の変更はお店に直接ご連絡ください」を案内する)
  | { ok: false; reason: "deadline_passed" }
  // これからの予約が1人あたりの上限に達している(UIはマイ予約での確認を案内する)
  | { ok: false; reason: "reservation_limit" }
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

    // 変更モード: 変更元IDの形式が不正なら「存在しない予約」と同じ扱いにする
    const isChange = input.changeReservationId !== undefined;
    if (
      input.changeReservationId !== undefined &&
      !isUuid(input.changeReservationId)
    ) {
      return { ok: false, reason: "change_source_gone" };
    }

    // b. 初回のみ顧客情報を検証(未入力は「空で入力された」として全項目エラーにする)。
    //    変更モードでは初回情報入力は発生しない(予約がある=登録済み顧客)。
    //    防御的に、顧客が見つからなければ認証相当のエラーとする
    const customer = await findCustomerByLineUserId(verified.userId);
    let newCustomer: { name: string; phone: string } | null = null;
    if (customer === null) {
      if (isChange) {
        return {
          ok: false,
          reason: "auth",
          message: "お客様情報が確認できませんでした",
        };
      }
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
    //    (UX向上のための事前チェック。最後の砦はEXCLUDE制約: ADR-004)。
    //    変更モードでは自分の旧予約を除外する(渡さないと旧枠が「埋まり」に見える)
    const day = await getDayAvailability(
      jstCalendarDate(start),
      input.menuIds,
      new Date(),
      input.changeReservationId,
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
    //    時間範囲はRPCがメニュー所要時間の合計から導出する)。
    //    変更モードでは change_reservation で「旧キャンセル+新規作成」を
    //    1トランザクションで行う(23P01時は全体がロールバックし旧予約は無傷)
    const supabase = getServiceRoleClient();
    let reservationId: string;
    if (input.changeReservationId !== undefined) {
      const { data, error } = await supabase.rpc("change_reservation", {
        p_line_user_id: verified.userId,
        p_reservation_id: input.changeReservationId,
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
        console.error("change_reservation failed", error);
        return {
          ok: false,
          reason: "server_error",
          message: "予約の変更に失敗しました",
        };
      }
      const outcome = parseChangeReservationResult(data);
      if (outcome.result === "not_found") {
        return { ok: false, reason: "change_source_gone" };
      }
      if (outcome.result === "deadline_passed") {
        return { ok: false, reason: "deadline_passed" };
      }
      if (outcome.result !== "ok") {
        console.error("change_reservation returned unexpected value", data);
        return {
          ok: false,
          reason: "server_error",
          message: "予約の変更に失敗しました",
        };
      }
      reservationId = outcome.reservationId;
    } else {
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
        // 1人あたりの予約上限超過(SQLSTATE R0001)
        if (isReservationLimitError(error)) {
          return { ok: false, reason: "reservation_limit" };
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
      reservationId = data;
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
        id: reservationId,
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
