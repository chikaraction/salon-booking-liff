"use client";

// マイ予約(クライアントコンポーネント)。
// 状態の保持と画面遷移の配線のみを行い、判断は src/lib/my-reservations.ts の
// 純粋関数とServer Action(src/app/my/actions.ts)に委ねる。
// 表示文字列はサーバーが整形済みのラベルをそのまま使う。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import {
  cancelReservation,
  getMyReservations,
  type MyReservationCard,
} from "@/app/my/actions";
import { Button } from "@/components/ui/button";
import { getLineIdToken } from "@/liff/client";
import {
  canModifyReservation,
  remainingDaysLabel,
} from "@/lib/my-reservations";

import { CancelSheet } from "./cancel-sheet";
import { ReservationCard } from "./reservation-card";

/** キャンセル操作の結果として一覧の上に出す案内 */
type Notice = {
  tone: "info" | "warn";
  text: string;
};

export function MyReservations() {
  // LINE IDトークン(ページ表示時に取得して保持。取れなければ案内画面を出す)
  const [idToken, setIdToken] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");

  // 一覧の取得状態
  const [listState, setListState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [listError, setListError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<MyReservationCard[]>([]);
  const [cancelDeadlineMinutes, setCancelDeadlineMinutes] = useState(0);

  // キャンセル確認シート
  const [cancelTarget, setCancelTarget] = useState<MyReservationCard | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // キャンセル結果の案内(成功・取り消し済み・締切超過)
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async (token: string) => {
    setListState("loading");
    setListError(null);
    const result = await getMyReservations(token);
    if (result.ok) {
      setReservations(result.reservations);
      setCancelDeadlineMinutes(result.cancelDeadlineMinutes);
      setListState("ready");
    } else {
      setListError(result.message);
      setListState("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getLineIdToken().then((token) => {
      if (cancelled) return;
      if (token !== null) {
        setIdToken(token);
        setTokenState("ready");
        void load(token);
      } else {
        setTokenState("unavailable");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // ------------------------------------------------------------------
  // ハンドラ
  // ------------------------------------------------------------------

  function openCancelSheet(reservation: MyReservationCard) {
    setCancelError(null);
    setCancelTarget(reservation);
  }

  function closeCancelSheet() {
    setCancelTarget(null);
    setCancelError(null);
  }

  async function confirmCancel() {
    if (idToken === null || cancelTarget === null) return;
    setCancelling(true);
    setCancelError(null);
    const result = await cancelReservation(idToken, cancelTarget.id);
    setCancelling(false);

    if (result.ok) {
      setNotice({ tone: "info", text: "予約をキャンセルしました" });
      closeCancelSheet();
      void load(idToken);
      return;
    }
    switch (result.reason) {
      case "not_found":
        // 既にキャンセル済み等。案内して一覧を最新に揃える
        setNotice({ tone: "warn", text: "この予約は既に取り消されています" });
        closeCancelSheet();
        void load(idToken);
        break;
      case "deadline_passed":
        setNotice({
          tone: "warn",
          text: "直前のキャンセルはお店に直接ご連絡ください",
        });
        closeCancelSheet();
        void load(idToken);
        break;
      default:
        // auth / server_error: シートを開いたまま表示し、再試行できるようにする
        setCancelError(result.message);
    }
  }

  // ------------------------------------------------------------------
  // 表示
  // ------------------------------------------------------------------

  if (tokenState === "unavailable") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-bold">LINEアプリから開いてください</h1>
        <p className="text-base text-muted-foreground">
          このページはLINEアプリ内でのみご利用いただけます。LINEのトーク画面から開き直してください。
        </p>
      </div>
    );
  }

  const loading = tokenState === "loading" || listState === "loading";
  // 残り日数・可否は表示時点の現在時刻で判定する(最終判定はRPC内: ADR-004と同じ発想)
  const now = new Date();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 pb-3 pt-4">
        <h1 className="text-2xl font-bold">マイ予約</h1>
        <p className="mt-1 text-base text-muted-foreground">今後のご予約</p>
      </header>

      <main className="flex-1 px-4 py-4">
        {notice !== null && (
          <p
            className={
              notice.tone === "warn"
                ? "mb-4 rounded-xl bg-destructive/10 p-4 text-base text-destructive"
                : "mb-4 rounded-xl bg-accent p-4 text-base text-primary-strong"
            }
          >
            {notice.text}
          </p>
        )}

        {loading && (
          <p className="py-8 text-center text-base text-muted-foreground">
            ご予約を確認しています…
          </p>
        )}

        {!loading && listState === "error" && (
          <div className="flex flex-col gap-4">
            <p className="rounded-xl bg-destructive/10 p-4 text-base text-destructive">
              {listError}
            </p>
            <Button
              variant="outline"
              className="h-12 w-full rounded-xl text-base"
              onClick={() => {
                if (idToken !== null) void load(idToken);
              }}
            >
              再読み込み
            </Button>
          </div>
        )}

        {!loading && listState === "ready" && reservations.length === 0 && (
          <div className="flex flex-col items-center gap-6 pt-16 text-center">
            <p className="text-base text-muted-foreground">
              今後のご予約はありません
            </p>
            <Button asChild className="h-12 w-full rounded-xl text-base">
              <Link href="/booking">予約する</Link>
            </Button>
          </div>
        )}

        {!loading && listState === "ready" && reservations.length > 0 && (
          <div className="flex flex-col gap-4">
            {reservations.map((reservation) => {
              const start = new Date(reservation.startISO);
              return (
                <ReservationCard
                  key={reservation.id}
                  reservation={reservation}
                  remainingLabel={remainingDaysLabel(now, start)}
                  canModify={canModifyReservation(
                    now,
                    start,
                    cancelDeadlineMinutes,
                  )}
                  onCancelClick={() => openCancelSheet(reservation)}
                />
              );
            })}
          </div>
        )}
      </main>

      {cancelTarget !== null && (
        <CancelSheet
          reservation={cancelTarget}
          busy={cancelling}
          error={cancelError}
          onConfirm={() => void confirmCancel()}
          onClose={closeCancelSheet}
        />
      )}
    </div>
  );
}
