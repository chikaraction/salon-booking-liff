"use client";

// 予約ウィザード(クライアントコンポーネント)。
// 選択状態の保持と画面遷移の配線のみを行い、判断は src/lib/ の純粋関数と
// Server Action(src/app/booking/actions.ts)に委ねる。
// 遷移: メニュー選択 → スタッフ選択 → 日時選択 →(初回のみ情報入力)→ 確認 → 完了

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import {
  checkCustomer,
  getAvailability,
  getChangeSource,
  submitReservation,
  type AvailabilitySlot,
  type ChangeSource,
} from "@/app/booking/actions";
import { Button } from "@/components/ui/button";
import { getLineIdToken } from "@/liff/client";
import {
  formatJstDateTimeLabel,
  formatYen,
  menuNamesLabel,
  summarizeSelectedMenus,
  validateCustomerInfo,
  type CustomerInfoErrors,
} from "@/lib/booking";
import type { BookingPageData } from "@/server/booking-data";

import { StepComplete } from "./step-complete";
import { StepConfirm } from "./step-confirm";
import { StepCustomerInfo } from "./step-customer-info";
import { StepDatetime } from "./step-datetime";
import { StepMenu } from "./step-menu";
import { ANY_STAFF, STAFF_ROLE_LABELS, StepStaff } from "./step-staff";
import { WizardHeader } from "./wizard-header";

type WizardStep =
  "menu" | "staff" | "datetime" | "info" | "confirm" | "complete";

type CompletedReservation = {
  startISO: string;
  staffName: string;
  totalPrice: number;
  totalDurationMinutes: number;
};

const SLOT_TAKEN_MESSAGE = "その枠は埋まりました。別の時間をお選びください";

/** 変更モード(M3)の状態。新規予約モードでは常に none */
type ChangeState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; source: ChangeSource }
  // 変更元が確認できない(取り消し済み・他人の予約など。マイ予約へ誘導する)
  | { status: "gone" }
  | { status: "error"; message: string };

export function BookingWizard({
  data,
  changeReservationId,
}: {
  data: BookingPageData;
  /** 変更モード(M3): 変更元の予約ID(/booking?change=<予約ID>)。省略時は新規予約 */
  changeReservationId?: string;
}) {
  const [step, setStep] = useState<WizardStep>("menu");

  // 変更モード(M3): 変更元の取得状態(初期選択への反映は取得後に行う)
  const [changeState, setChangeState] = useState<ChangeState>(
    changeReservationId !== undefined
      ? { status: "loading" }
      : { status: "none" },
  );

  // LINE IDトークン(ページ表示時に取得して保持。取れなければ案内画面を出す)
  const [idToken, setIdToken] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");

  // 選択状態
  const [selectedMenuIds, setSelectedMenuIds] = useState<string[]>([]);
  const [staffSelection, setStaffSelection] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedStartISO, setSelectedStartISO] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // 空き枠の取得状態
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const availabilityRequestSeq = useRef(0);

  // 初回情報入力
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerErrors, setCustomerErrors] = useState<CustomerInfoErrors>({});

  // 進行中・エラー・完了
  const [busy, setBusy] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [slotTakenNotice, setSlotTakenNotice] = useState(false);
  const [completed, setCompleted] = useState<CompletedReservation | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLineIdToken().then(async (token) => {
      if (cancelled) return;
      if (token === null) {
        setTokenState("unavailable");
        return;
      }
      setIdToken(token);
      setTokenState("ready");

      // 変更モード(M3): 変更元を取得し、メニュー・スタッフ・メモを初期選択にする
      if (changeReservationId === undefined) return;
      const result = await getChangeSource(token, changeReservationId);
      if (cancelled) return;
      if (result.ok) {
        // 現在のメニュー一覧に無いもの(削除済み・無効化済み)は初期選択から外す
        const currentMenuIds = new Set(
          data.categories.flatMap((category) =>
            category.menus.map((menu) => menu.id),
          ),
        );
        setSelectedMenuIds(
          result.source.menuIds.filter((menuId) => currentMenuIds.has(menuId)),
        );
        // スタッフも同様に、現在の有効スタッフに居る場合のみ初期選択にする
        if (data.staff.some((member) => member.id === result.source.staffId)) {
          setStaffSelection(result.source.staffId);
        }
        setNote(result.source.note);
        setChangeState({ status: "ready", source: result.source });
      } else if (result.reason === "not_found") {
        setChangeState({ status: "gone" });
      } else {
        setChangeState({ status: "error", message: result.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [changeReservationId, data]);

  // ------------------------------------------------------------------
  // 派生値
  // ------------------------------------------------------------------

  const isChangeMode = changeReservationId !== undefined;

  const allMenus = useMemo(
    () => data.categories.flatMap((category) => category.menus),
    [data.categories],
  );
  const selectedMenus = useMemo(
    () => allMenus.filter((menu) => selectedMenuIds.includes(menu.id)),
    [allMenus, selectedMenuIds],
  );
  const summary = summarizeSelectedMenus(selectedMenus);
  const menusLabel = menuNamesLabel(selectedMenus.map((menu) => menu.name));

  const selectedStaff =
    staffSelection !== null && staffSelection !== ANY_STAFF
      ? (data.staff.find((member) => member.id === staffSelection) ?? null)
      : null;
  /** チップ用の短い表示(例: 田中) */
  const staffChipLabel =
    staffSelection === ANY_STAFF ? "どちらでも" : selectedStaff?.name;
  /** 確認画面用の表示(例: 田中(オーナー)) */
  const staffConfirmLabel =
    staffSelection === ANY_STAFF
      ? "どちらでも(空いているスタッフにお任せ)"
      : selectedStaff !== null
        ? `${selectedStaff.name}(${STAFF_ROLE_LABELS[selectedStaff.role]})`
        : "";

  // 選択済みの内容を上部にチップで常時表示(メニュー要約・スタッフ・日時)
  const chips: string[] = [];
  if (step === "staff") {
    chips.push(
      menusLabel,
      `${formatYen(summary.totalPrice)} / ${summary.totalDurationMinutes}分`,
    );
  }
  if (step === "datetime" || step === "info" || step === "confirm") {
    chips.push(menusLabel);
    if (staffChipLabel !== undefined) chips.push(staffChipLabel);
  }
  if ((step === "info" || step === "confirm") && selectedStartISO !== null) {
    chips.push(formatJstDateTimeLabel(new Date(selectedStartISO)));
  }

  // ------------------------------------------------------------------
  // ハンドラ
  // ------------------------------------------------------------------

  function toggleMenu(menuId: string) {
    setSelectedMenuIds((current) =>
      current.includes(menuId)
        ? current.filter((id) => id !== menuId)
        : [...current, menuId],
    );
    // 所要時間が変わると空き枠も変わるため、日時の選択をやり直す
    resetDatetime();
  }

  function selectStaff(selection: string) {
    if (selection === staffSelection) return;
    setStaffSelection(selection);
    // スタッフが変わると空き枠も変わるため、日時の選択をやり直す
    resetDatetime();
  }

  function resetDatetime() {
    setSelectedDate(null);
    setSelectedStartISO(null);
    setSlots(null);
    setSlotsError(null);
    setSlotTakenNotice(false);
  }

  async function loadAvailability(date: string, staff: string) {
    const seq = ++availabilityRequestSeq.current;
    setSlots(null);
    setSlotsError(null);
    setSlotsLoading(true);
    // 変更モードでは自分の旧予約の枠を空きとして見せる(本人確認はサーバーで行う)
    const result = await getAvailability(
      date,
      selectedMenuIds,
      staff,
      changeReservationId !== undefined && idToken !== null
        ? { idToken, reservationId: changeReservationId }
        : undefined,
    );
    if (seq !== availabilityRequestSeq.current) return; // 古い応答は捨てる
    setSlotsLoading(false);
    if (result.ok) {
      setSlots(result.slots);
    } else {
      setSlotsError(result.message);
    }
  }

  function handleSelectDate(date: string) {
    if (staffSelection === null) return;
    setSelectedDate(date);
    setSelectedStartISO(null);
    void loadAvailability(date, staffSelection);
  }

  /** 日時選択 → 初回判定(checkCustomer)→ 情報入力 or 確認へ */
  async function proceedFromDatetime() {
    if (idToken === null) return;
    setBusy(true);
    setFlowError(null);
    const result = await checkCustomer(idToken);
    setBusy(false);
    if (!result.ok) {
      setFlowError(result.message);
      return;
    }
    setIsNewCustomer(result.isNew);
    setSlotTakenNotice(false);
    setStep(result.isNew ? "info" : "confirm");
  }

  /** 初回情報入力 → クライアント側で検証して確認へ(サーバーでも再検証される) */
  function proceedFromInfo() {
    const validated = validateCustomerInfo({
      name: customerName,
      phone: customerPhone,
    });
    if (!validated.ok) {
      setCustomerErrors(validated.errors);
      return;
    }
    setCustomerErrors({});
    setStep("confirm");
  }

  async function submit() {
    if (
      idToken === null ||
      staffSelection === null ||
      selectedStartISO === null
    ) {
      return;
    }
    setBusy(true);
    setFlowError(null);
    const result = await submitReservation({
      idToken,
      staffSelection,
      startISO: selectedStartISO,
      menuIds: selectedMenuIds,
      note: note.trim() === "" ? undefined : note.trim(),
      customerInfo: isNewCustomer
        ? { name: customerName, phone: customerPhone }
        : undefined,
      changeReservationId,
    });
    setBusy(false);

    if (result.ok) {
      setCompleted({
        startISO: result.reservation.startISO,
        staffName: result.reservation.staffName,
        totalPrice: result.reservation.totalPrice,
        totalDurationMinutes: result.reservation.totalDurationMinutes,
      });
      setStep("complete");
      return;
    }
    switch (result.reason) {
      case "slot_taken":
        // 枠が埋まっていたら日時選択に戻し、空き枠を取り直す
        setSlotTakenNotice(true);
        setSelectedStartISO(null);
        setStep("datetime");
        if (selectedDate !== null) {
          void loadAvailability(selectedDate, staffSelection);
        }
        break;
      case "invalid_customer_info":
        setCustomerErrors(result.errors);
        setStep("info");
        break;
      case "change_source_gone":
        // 変更元が取り消し済み等。専用画面でマイ予約へ誘導する
        setChangeState({ status: "gone" });
        break;
      case "deadline_passed":
        setFlowError("直前の変更はお店に直接ご連絡ください");
        break;
      default:
        setFlowError(result.message);
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

  // 変更モード: 変更元が確認できない(取り消し済み・他人の予約など)
  if (changeState.status === "gone") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-bold">この予約は変更できません</h1>
        <p className="text-base text-muted-foreground">
          既に取り消されているか、変更できない予約です。マイ予約からやり直してください。
        </p>
        <Button
          asChild
          className="mt-3 h-12 w-full rounded-xl text-base font-bold"
        >
          <Link href="/my">マイ予約へ戻る</Link>
        </Button>
      </div>
    );
  }

  // 変更モード: 変更元の取得に失敗(認証・サーバーエラー)
  if (changeState.status === "error") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="w-full rounded-xl bg-destructive/10 p-4 text-base text-destructive">
          {changeState.message}
        </p>
        <Button
          asChild
          variant="outline"
          className="mt-3 h-12 w-full rounded-xl text-base font-bold"
        >
          <Link href="/my">マイ予約へ戻る</Link>
        </Button>
      </div>
    );
  }

  // 変更モード: 変更元の取得と初期選択への反映が済むまでウィザードを出さない
  if (changeState.status === "loading") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="text-base text-muted-foreground">
          変更元のご予約を確認しています…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      {step === "menu" && (
        <WizardHeader
          step={1}
          title="メニューを選ぶ"
          subtitle="複数選べます(例: カット + カラー)"
        />
      )}
      {step === "staff" && (
        <WizardHeader step={2} title="スタッフを選ぶ" chips={chips} />
      )}
      {step === "datetime" && (
        <WizardHeader step={3} title="日時を選ぶ" chips={chips} />
      )}
      {step === "info" && (
        <WizardHeader
          title="お客様情報の入力"
          subtitle="初回のみ。次回からは入力不要です"
          chips={chips}
        />
      )}
      {step === "confirm" && (
        <WizardHeader step={4} title="内容の確認" chips={chips} />
      )}

      {/* 変更モード: 変更元がわかる控えめな表示(完了画面では出さない) */}
      {changeState.status === "ready" && step !== "complete" && (
        <p className="border-b border-border bg-secondary/60 px-4 py-2 text-sm text-secondary-foreground">
          予約の変更(変更前: {changeState.source.dateTimeLabel})
        </p>
      )}

      <main className="flex-1 px-4 py-4">
        {flowError !== null && step !== "complete" && (
          <p className="mb-4 rounded-xl bg-destructive/10 p-4 text-base text-destructive">
            {flowError}
          </p>
        )}
        {slotTakenNotice && step === "datetime" && (
          <p className="mb-4 rounded-xl bg-destructive/10 p-4 text-base text-destructive">
            {SLOT_TAKEN_MESSAGE}
          </p>
        )}

        {step === "menu" && (
          <StepMenu
            categories={data.categories}
            selectedMenuIds={selectedMenuIds}
            onToggle={toggleMenu}
          />
        )}
        {step === "staff" && (
          <StepStaff
            staff={data.staff}
            selection={staffSelection}
            onSelect={selectStaff}
          />
        )}
        {step === "datetime" && (
          <StepDatetime
            businessHours={data.businessHours}
            policy={data.policy}
            durationMinutes={summary.totalDurationMinutes}
            selectedDate={selectedDate}
            slots={slots}
            slotsLoading={slotsLoading}
            slotsError={slotsError}
            selectedStartISO={selectedStartISO}
            onSelectDate={handleSelectDate}
            onSelectStart={setSelectedStartISO}
          />
        )}
        {step === "info" && (
          <StepCustomerInfo
            name={customerName}
            phone={customerPhone}
            errors={customerErrors}
            onChangeName={setCustomerName}
            onChangePhone={setCustomerPhone}
          />
        )}
        {step === "confirm" && selectedStartISO !== null && (
          <StepConfirm
            menus={selectedMenus}
            staffLabel={staffConfirmLabel}
            startISO={selectedStartISO}
            totalPrice={summary.totalPrice}
            totalDurationMinutes={summary.totalDurationMinutes}
            note={note}
            onChangeNote={setNote}
          />
        )}
        {step === "complete" && completed !== null && (
          <StepComplete
            heading={
              isChangeMode ? "予約を変更しました" : "ご予約が完了しました"
            }
            startISO={completed.startISO}
            menusLabel={menusLabel}
            staffName={completed.staffName}
            totalPrice={completed.totalPrice}
            totalDurationMinutes={completed.totalDurationMinutes}
          />
        )}
      </main>

      <footer className="sticky bottom-0 z-10 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {step === "menu" && (
          <>
            <div className="flex items-baseline justify-between pb-2">
              <p className="text-sm text-muted-foreground">
                選択中 {summary.count}件・合計 約{summary.totalDurationMinutes}
                分
              </p>
              <p className="text-xl font-bold">
                {formatYen(summary.totalPrice)}
              </p>
            </div>
            <Button
              className="h-12 w-full rounded-xl text-base font-bold"
              disabled={summary.count === 0}
              onClick={() => setStep("staff")}
            >
              次へ(スタッフ選択)
            </Button>
          </>
        )}
        {step === "staff" && (
          <FooterNav
            onBack={() => setStep("menu")}
            nextLabel="次へ(日時選択)"
            nextDisabled={staffSelection === null}
            onNext={() => setStep("datetime")}
          />
        )}
        {step === "datetime" && (
          <FooterNav
            onBack={() => setStep("staff")}
            nextLabel={busy ? "確認しています…" : "確認へ進む"}
            nextDisabled={
              selectedStartISO === null || tokenState !== "ready" || busy
            }
            onNext={() => void proceedFromDatetime()}
          />
        )}
        {step === "info" && (
          <Button
            className="h-12 w-full rounded-xl text-base font-bold"
            onClick={proceedFromInfo}
          >
            確認画面へ
          </Button>
        )}
        {step === "confirm" && (
          <FooterNav
            onBack={() => setStep(isNewCustomer ? "info" : "datetime")}
            nextLabel={
              busy
                ? isChangeMode
                  ? "変更しています…"
                  : "予約しています…"
                : isChangeMode
                  ? "予約を変更する"
                  : "予約を確定する"
            }
            nextDisabled={busy}
            onNext={() => void submit()}
          />
        )}
        {step === "complete" && (
          // 完了画面の導線: マイ予約で内容を確認できる(新規・変更とも)
          <Button
            asChild
            variant="outline"
            className="h-12 w-full rounded-xl text-base font-bold text-primary"
          >
            <Link href="/my">マイ予約を見る</Link>
          </Button>
        )}
      </footer>
    </div>
  );
}

function FooterNav({
  onBack,
  nextLabel,
  nextDisabled,
  onNext,
}: {
  onBack: () => void;
  nextLabel: string;
  nextDisabled: boolean;
  onNext: () => void;
}) {
  return (
    <div className="flex gap-3">
      <Button
        variant="outline"
        className="h-12 w-28 rounded-xl text-base font-bold"
        onClick={onBack}
      >
        戻る
      </Button>
      <Button
        className="h-12 flex-1 rounded-xl text-base font-bold"
        disabled={nextDisabled}
        onClick={onNext}
      >
        {nextLabel}
      </Button>
    </div>
  );
}
