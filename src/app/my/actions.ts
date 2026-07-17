"use server";

// マイ予約(M3)のServer Action(配線に徹する。判断は src/lib/ の純粋関数)。
// - 認証はLINE IDトークンのサーバー側検証のみを信頼する(ADR-003)
// - キャンセルの本人確認・締切判定の最終判定はRPC(cancel_reservation)内で行う。
//   アプリ側の締切判定(canModifyReservation)はUI表示用の補助であり、
//   ここでは二重に弾かない(ADR-004と同じ発想)
// - 戻り値はすべて判別可能なResult型(ok + reason)でUIが分岐に迷わない形にする

import {
  buildReservationCard,
  type ReservationCard,
} from "@/lib/my-reservations";
import {
  getCancelDeadlineMinutes,
  getUpcomingReservations,
} from "@/server/booking-data";
import { verifyLineIdToken } from "@/server/line";
import { getServiceRoleClient } from "@/server/supabase";

// ---------------------------------------------------------------------------
// マイ予約一覧の取得
// ---------------------------------------------------------------------------

/** ReservationCard のシリアライズ境界用の派生型(Dateを startISO に置き換える) */
export type MyReservationCard = Omit<ReservationCard, "start"> & {
  /** 開始時刻(UTCのISO文字列) */
  startISO: string;
};

export type GetMyReservationsResult =
  | {
      ok: true;
      reservations: MyReservationCard[];
      /** 開始何分前まで客自身で変更・キャンセルできるか(UIの可否表示用) */
      cancelDeadlineMinutes: number;
    }
  | { ok: false; reason: "auth"; message: string }
  | { ok: false; reason: "server_error"; message: string };

/** 今後の確定予約一覧をカード表示用に整形して返す */
export async function getMyReservations(
  idToken: string,
): Promise<GetMyReservationsResult> {
  try {
    const verified = await verifyLineIdToken(idToken);
    if (!verified.ok) {
      return { ok: false, reason: "auth", message: verified.message };
    }

    const [upcoming, cancelDeadlineMinutes] = await Promise.all([
      getUpcomingReservations(verified.userId, new Date()),
      getCancelDeadlineMinutes(),
    ]);

    return {
      ok: true,
      reservations: upcoming.map((input) => {
        const { start, ...card } = buildReservationCard(input);
        return { ...card, startISO: start.toISOString() };
      }),
      cancelDeadlineMinutes,
    };
  } catch (error) {
    console.error("getMyReservations failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "予約の取得に失敗しました",
    };
  }
}

// ---------------------------------------------------------------------------
// キャンセル
// ---------------------------------------------------------------------------

export type CancelReservationResult =
  | { ok: true }
  | { ok: false; reason: "auth"; message: string }
  // 存在しない・他人の予約・キャンセル済み(UIは一覧を再取得する)
  | { ok: false; reason: "not_found" }
  // 締切超過(UIは「お店に直接ご連絡ください」を案内する)
  | { ok: false; reason: "deadline_passed" }
  | { ok: false; reason: "server_error"; message: string };

/** 予約をキャンセルする。本人確認・締切の最終判定はRPC内で行う */
export async function cancelReservation(
  idToken: string,
  reservationId: string,
): Promise<CancelReservationResult> {
  try {
    const verified = await verifyLineIdToken(idToken);
    if (!verified.ok) {
      return { ok: false, reason: "auth", message: verified.message };
    }

    const supabase = getServiceRoleClient();
    const { data, error } = await supabase.rpc("cancel_reservation", {
      p_line_user_id: verified.userId,
      p_reservation_id: reservationId,
    });
    if (error !== null) {
      console.error("cancel_reservation failed", error);
      return {
        ok: false,
        reason: "server_error",
        message: "予約のキャンセルに失敗しました",
      };
    }

    if (data === "ok") {
      return { ok: true };
    }
    if (data === "not_found") {
      return { ok: false, reason: "not_found" };
    }
    if (data === "deadline_passed") {
      return { ok: false, reason: "deadline_passed" };
    }

    console.error("cancel_reservation returned unexpected value", data);
    return {
      ok: false,
      reason: "server_error",
      message: "予約のキャンセルに失敗しました",
    };
  } catch (error) {
    console.error("cancelReservation failed", error);
    return {
      ok: false,
      reason: "server_error",
      message: "予約のキャンセルに失敗しました",
    };
  }
}
