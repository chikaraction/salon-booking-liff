"use client";

// 予約詳細ダイアログ(モックC)。状態保持と配線に徹する。
// - 詳細取得・キャンセル・スタッフメモ更新は Server Action に委ねる
// - 整形(日時・担当/メニュー合計)は純粋関数 admin-calendar.ts に委ねる
// - このプロジェクトのダイアログ流儀(radix Dialog は使わず role="dialog"
//   aria-modal + fixed オーバーレイ + 背景クリックで閉じる)に合わせる
//   (src/app/my/_components/cancel-sheet.tsx を参照)

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  cancelReservationByAdmin,
  getReservationDetailAction,
  updateStaffMemo,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { buildReservationDetailLabels } from "@/lib/admin-calendar";
import type { ReservationDetail } from "@/server/admin-data";

/**
 * 店側キャンセルの確認ステップが出てから「キャンセルする」を押せるようになるまでの待ち時間(ms)。
 * 確認ステップは「店側でキャンセル」と同じ場所に入れ替わって出るため、「キャンセルする」が
 * 直前に押した位置に重なり、素早い2回押しで確認を飛ばしてしまう。それを防ぐ
 * (docs/ui-guidelines.md「破壊的な確認は、出てから0.5秒は決定を押せなくする」)
 */
const CANCEL_CONFIRM_ARM_DELAY_MS = 500;

type Props = {
  /** 表示中の予約ID(カレンダーの予約カードから受け取る) */
  reservationId: string;
  onClose: () => void;
  /**
   * 「変更」を押したときに呼ばれる。取得済みの詳細をそのまま渡し、
   * 呼び出し側(カレンダー)が変更ダイアログを開く = ページ遷移しないので
   * 背後のカレンダーを見ながら日時を調整でき、詳細にも引き返せる
   */
  onEdit: (detail: ReservationDetail) => void;
};

export function ReservationDetailDialog({
  reservationId,
  onClose,
  onEdit,
}: Props) {
  const router = useRouter();

  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReservationDetail | null>(null);

  // 詳細を取得する(状態更新は解決後のコールバックでのみ行い、effect内での
  // 同期的なsetStateを避ける)。呼び出し側は reservationId を key にして
  // ID変更時にこのコンポーネントを作り直すため、初期状態は "loading" でよい。
  useEffect(() => {
    let ignore = false;
    void getReservationDetailAction(reservationId).then((result) => {
      if (ignore) return;
      if (result.ok) {
        setDetail(result.detail);
        setState("ready");
      } else {
        setErrorMessage(result.message);
        setState("error");
      }
    });
    return () => {
      ignore = true;
    };
  }, [reservationId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-detail-title"
    >
      {/* 背景(クリックで閉じる) */}
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />

      {/* カード本体 */}
      <div className="relative z-10 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-card p-6 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <h2 id="reservation-detail-title" className="text-xl font-bold">
            予約詳細
          </h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            // モックC の ✕ は枠なしで地 #f2f0ea(--secondary)。hover は地を少し濃くする
            // (button.tsx の secondary variant と同じ式)
            // 地の四角は 36px のまま、押せる範囲だけ疑似要素で四方に 4px 広げて 44×44 にする
            // (Apple HIG の最小タップ領域 44pt。スマホで指が外れにくくする)
            className="relative flex size-9 items-center after:absolute after:-inset-1 justify-center rounded-lg bg-secondary text-muted-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] hover:text-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        {state === "loading" && (
          <p className="py-10 text-center text-base text-muted-foreground">
            読み込み中…
          </p>
        )}

        {state === "error" && (
          <p className="mt-6 rounded-xl bg-destructive/10 p-4 text-base text-destructive">
            {errorMessage}
          </p>
        )}

        {state === "ready" && detail !== null && (
          <DetailBody
            detail={detail}
            onClose={onClose}
            onEdit={onEdit}
            router={router}
          />
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}

function DetailBody({
  detail,
  onClose,
  onEdit,
  router,
}: {
  detail: ReservationDetail;
  onClose: () => void;
  onEdit: (detail: ReservationDetail) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const labels = buildReservationDetailLabels({
    start: detail.start,
    staffName: detail.staffName,
    menus: detail.menus,
    requestNote: detail.requestNote,
  });

  // スタッフメモの編集(その場でテキストエリア → 保存 → 表示に戻す)
  const [memo, setMemo] = useState<string | null>(detail.staffMemo);
  const [editing, setEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const [savingMemo, setSavingMemo] = useState(false);
  const [memoError, setMemoError] = useState<string | null>(null);

  // 店側キャンセルの確認・実行
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // 確認ステップが出てから一定時間たち、「キャンセルする」を押せる状態か。
  // false に戻すのは確認ステップを開く onClick の中(effect内で同期的にsetStateしない)
  const [cancelArmed, setCancelArmed] = useState(false);

  // 確認ステップが出ている間だけタイマーを張り、時間がたったら押せるようにする。
  // 閉じたとき・アンマウントのときは cleanup でタイマーを片付ける
  useEffect(() => {
    if (!confirmingCancel) return;
    const timer = setTimeout(
      () => setCancelArmed(true),
      CANCEL_CONFIRM_ARM_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [confirmingCancel]);

  function startEdit() {
    setMemoDraft(memo ?? "");
    setMemoError(null);
    setEditing(true);
  }

  async function saveMemo() {
    setSavingMemo(true);
    setMemoError(null);
    const result = await updateStaffMemo(detail.customerId, memoDraft);
    setSavingMemo(false);
    if (result.ok) {
      const trimmed = memoDraft.trim();
      setMemo(trimmed === "" ? null : trimmed);
      setEditing(false);
    } else {
      setMemoError(result.message);
    }
  }

  async function confirmCancel() {
    setCancelling(true);
    setCancelError(null);
    const result = await cancelReservationByAdmin(detail.id);
    setCancelling(false);
    if (result.ok || result.reason === "not_found") {
      // 成功・既にキャンセル済みのどちらも枠は空き。カレンダーを最新化して閉じる
      onClose();
      router.refresh();
      return;
    }
    setCancelError(result.message);
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <Field label="お客様" value={`${detail.customerName} 様`} />
      <Field label="連絡先" value={detail.customerPhone ?? "—"} />
      <Field label="日時 / 担当" value={labels.dateTimeStaffLabel} />
      <Field label="メニュー" value={labels.menuLabel} />

      {/* ご要望・ご相談(= reservations.note。客の予約時のほか、スタッフが変更画面でも
          書き直せる)。空でも欄を出し、空なら「(なし)」を控えめな色で出す
          (docs/milestone-4-plan.md の決定5) */}
      <div className="rounded-xl bg-accent p-4">
        <p className="text-sm font-bold text-primary-strong">ご要望・ご相談</p>
        <p className="mt-1 whitespace-pre-wrap text-base text-accent-foreground">
          {labels.requestNote.isEmpty ? (
            <span className="text-muted-foreground">
              {labels.requestNote.text}
            </span>
          ) : (
            labels.requestNote.text
          )}
        </p>
      </div>

      {/* スタッフメモ(店内用・スタッフが記入 = customers.note。編集可) */}
      <div className="rounded-xl bg-muted p-4">
        {/* スマホ幅で「編集」が押しつぶされて縦に折り返さないよう、折り返すのはラベル側にする。
            gap-3 は「編集」の押せる範囲(左へ約8px はみ出す)がラベルの文字に重ならないための間隔 */}
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-bold">
            スタッフメモ{" "}
            <span className="font-normal text-muted-foreground">
              (店内用・スタッフが記入)
            </span>
          </p>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              // 文字だけのボタンは小さく押しにくいので、見た目は変えずに押せる範囲だけ
              // 疑似要素でボタンの中心から 44×44 に広げる(Apple HIG の最小タップ領域 44pt)。
              // 広げた分はメモ枠の余白(p-4 = 16px)の内側に収まる
              className="relative shrink-0 text-sm font-medium whitespace-nowrap text-primary underline-offset-4 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 hover:underline"
            >
              編集
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={memoDraft}
              onChange={(event) => setMemoDraft(event.target.value)}
              disabled={savingMemo}
              rows={3}
              // メモ欄の地(--muted)はページ背景と同じ値なので、ほかの入力欄と同じ
              // 白地+入力欄の枠(--input)にして、欄の範囲が分かるようにする
              className="w-full resize-none rounded-lg border border-input bg-card p-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="アレルギー・次回提案など(店内用)"
            />
            {memoError !== null && (
              <p className="text-sm text-destructive">{memoError}</p>
            )}
            {/* スマホで押しやすいよう高さ 44px(Apple HIG の最小タップ領域 44pt)・
                枠のあるボタン同士の間隔 12px にする(メニュー編集の保存・キャンセルと同じ大きさ) */}
            <div className="flex gap-3">
              <Button
                size="lg"
                className="h-11 rounded-lg px-5 text-base"
                disabled={savingMemo}
                onClick={() => void saveMemo()}
              >
                {savingMemo ? "保存しています…" : "保存"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 rounded-lg px-5 text-base"
                disabled={savingMemo}
                onClick={() => setEditing(false)}
              >
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap text-base">
            {memo ?? <span className="text-muted-foreground">(未記入)</span>}
          </p>
        )}
      </div>

      {/* 下部アクション。モックは height:46px・角丸10px(rounded-lg = --radius = 10px)。
          確認ステップの「戻る / キャンセルする」も同じ位置に入れ替わって出るので高さをそろえる */}
      {confirmingCancel ? (
        <div className="rounded-xl border border-border p-4">
          <p className="text-base font-bold">この予約をキャンセルしますか？</p>
          <p className="mt-1 text-sm text-muted-foreground">
            キャンセルすると枠が空きに戻ります。
          </p>
          {cancelError !== null && (
            <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {cancelError}
            </p>
          )}
          {/* 横並びは「やめる(左) → 決定(右)」(docs/ui-guidelines.md) */}
          <div className="mt-4 flex gap-3">
            <Button
              size="lg"
              variant="outline"
              className="h-[46px] flex-1 rounded-lg"
              disabled={cancelling}
              onClick={() => {
                setConfirmingCancel(false);
                setCancelError(null);
              }}
            >
              戻る
            </Button>
            <Button
              size="lg"
              variant="destructive"
              className="h-[46px] flex-1 rounded-lg"
              disabled={cancelling || !cancelArmed}
              onClick={() => void confirmCancel()}
            >
              {cancelling ? "キャンセルしています…" : "キャンセルする"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          {/* 変更はページ遷移せず、カレンダー上の変更ダイアログ(非モーダル・
              ドラッグ可)に切り替える。取得済みの詳細をそのまま渡すので
              再取得しない(呼び出し側が ReservationFormDialog を開く) */}
          <Button
            size="lg"
            className="h-[46px] flex-1 rounded-lg"
            onClick={() => onEdit(detail)}
          >
            変更
          </Button>
          <Button
            size="lg"
            variant="outline-destructive"
            className="h-[46px] flex-1 rounded-lg"
            onClick={() => {
              setCancelError(null);
              // 開き直すたびに、出てから0.5秒は押せない状態から始める
              setCancelArmed(false);
              setConfirmingCancel(true);
            }}
          >
            店側でキャンセル
          </Button>
        </div>
      )}
    </div>
  );
}
