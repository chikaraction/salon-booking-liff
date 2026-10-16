"use client";

// 店舗・予約設定のフォーム(モックなし。既存の設定画面と同じトーンで組む)。
// 配線に徹する: 入力の検証・補足文の組み立ては src/lib/salon-settings.ts の
// 純粋関数が担い、ここは状態とServer Actionの呼び出しだけ。
//
// 節ごとに保存ボタンを持たせる(営業日設定と同じ作法)。店名と予約ポリシーは
// 同じ salon_settings の行だが、変わったときの影響先が別(店名=管理画面の
// 見出し、ポリシー=客側の枠)なので、節も保存も分けている。

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  saveBookingPolicy,
  saveSalonName,
} from "@/app/admin/(protected)/settings/actions";
import {
  ChangedMark,
  SectionFooter,
  UnsavedBadge,
  useSavedDraft,
} from "@/app/admin/(protected)/settings/_components/unsaved-changes";
import {
  BOOKING_POLICY_LIMITS,
  SALON_NAME_MAX_LENGTH,
  changedBookingPolicyFields,
  describeBookingWindow,
  describeCancelDeadline,
  describeMinLead,
  describeSlotInterval,
  isSalonNameChanged,
  validateBookingPolicyInput,
  validateSalonName,
  type BookingPolicyErrors,
  type BookingPolicyInput,
} from "@/lib/salon-settings";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const fieldLabelClass = "text-base font-bold text-foreground";

type Props = {
  /** 現在の店名(salon_settings.name) */
  name: string;
  /** 現在の予約ポリシー(数値の入力欄なので文字列で持つ) */
  policy: BookingPolicyInput;
};

export function SalonSettingsForm({ name, policy }: Props) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="border-b border-border p-6 md:p-8">
          <h1 className="text-2xl font-bold text-foreground">店舗</h1>
          <p className="mt-2 text-base text-muted-foreground">
            店名は管理画面のログイン画面とサイドバーの見出しに表示されます。
          </p>
        </div>
        <div className="p-6 md:p-8">
          <SalonNameSection name={name} />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="border-b border-border p-6 md:p-8">
          <h2 className="text-2xl font-bold text-foreground">
            予約の受付ルール
          </h2>
          <p className="mt-2 text-base text-muted-foreground">
            お客様の予約画面で、いつ・どの時刻の枠を出すかを決める設定です。
          </p>
        </div>
        <div className="p-6 md:p-8">
          <BookingPolicySection policy={policy} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 店名(salon_settings.name)
// ---------------------------------------------------------------------------

function SalonNameSection({ name }: { name: string }) {
  const router = useRouter();
  // 保存済みの店名(props)が基準。前後の空白だけの違いは変更にしない
  // (保存時に落とすため)
  const {
    draft: value,
    setDraft: setValue,
    revert,
    markSaved,
    base,
  } = useSavedDraft<string>(name, (a, b) => !isSalonNameChanged(a, b));
  const isDirty = isSalonNameChanged(base, value);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleRevert = () => {
    setError(null);
    setMessage(null);
    setSaved(false);
    revert();
  };

  const handleSave = () => {
    setMessage(null);
    setSaved(false);
    const validated = validateSalonName(value);
    if (!validated.ok) {
      setError(validated.message);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveSalonName(value);
      if (result.ok) {
        setSaved(true);
        // 保存した値が新しい基準になる(= 変更なしの状態に戻る)
        markSaved();
        // サイドバーの見出し(保護レイアウト)を新しい店名で描き直す
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="salon-name" className={fieldLabelClass}>
            店名
          </label>
          {isDirty && <UnsavedBadge />}
        </div>
        <input
          id="salon-name"
          type="text"
          value={value}
          maxLength={SALON_NAME_MAX_LENGTH}
          onChange={(event) => {
            setSaved(false);
            setMessage(null);
            setValue(event.target.value);
          }}
          className={cn(inputClass, "w-full max-w-md")}
        />
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <SectionFooter
        isPending={isPending}
        isDirty={isDirty}
        message={message}
        saved={saved}
        onSave={handleSave}
        onRevert={handleRevert}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 予約の受付ルール(刻み・受付期間・直前締切・キャンセル締切)
// ---------------------------------------------------------------------------

function BookingPolicySection({ policy }: { policy: BookingPolicyInput }) {
  const router = useRouter();
  // 保存済みの値(props)が基準。変更された入力欄の判定は純粋関数に任せる
  const {
    base,
    draft: input,
    setDraft: setInput,
    revert,
    markSaved,
  } = useSavedDraft<BookingPolicyInput>(
    policy,
    (a, b) => changedBookingPolicyFields(a, b).length === 0,
  );
  const changedFields = changedBookingPolicyFields(base, input);
  const isDirty = changedFields.length > 0;
  const [errors, setErrors] = useState<BookingPolicyErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const update = (patch: Partial<BookingPolicyInput>) => {
    setSaved(false);
    setMessage(null);
    setInput((current) => ({ ...current, ...patch }));
  };

  const handleRevert = () => {
    setErrors({});
    setMessage(null);
    setSaved(false);
    revert();
  };

  const handleSave = () => {
    setMessage(null);
    setSaved(false);
    const validated = validateBookingPolicyInput(input);
    if (!validated.ok) {
      setErrors(validated.errors);
      setMessage(validated.message);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveBookingPolicy(input);
      if (result.ok) {
        setSaved(true);
        // 保存した値が新しい基準になる(= 変更なしの状態に戻る)
        markSaved();
        // 刻みは管理画面カレンダーの空き枠クリックにも効くので取り直す
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <section className="flex flex-col gap-6">
      <PolicyField
        id="slot-interval-minutes"
        changed={changedFields.includes("slotIntervalMinutes")}
        label="空き枠の刻み"
        unit="分"
        min={BOOKING_POLICY_LIMITS.slotIntervalMinutes.min}
        max={BOOKING_POLICY_LIMITS.slotIntervalMinutes.max}
        value={input.slotIntervalMinutes}
        description={describeSlotInterval(input.slotIntervalMinutes)}
        error={errors.slotIntervalMinutes}
        onChange={(next) => update({ slotIntervalMinutes: next })}
      />

      <PolicyField
        id="booking-window-days"
        changed={changedFields.includes("bookingWindowDays")}
        label="受付期間"
        unit="日"
        min={BOOKING_POLICY_LIMITS.bookingWindowDays.min}
        max={BOOKING_POLICY_LIMITS.bookingWindowDays.max}
        value={input.bookingWindowDays}
        description={describeBookingWindow(input.bookingWindowDays)}
        error={errors.bookingWindowDays}
        onChange={(next) => update({ bookingWindowDays: next })}
      />

      <PolicyField
        id="min-lead-minutes"
        changed={changedFields.includes("minLeadMinutes")}
        label="直前締切"
        unit="分"
        min={BOOKING_POLICY_LIMITS.minLeadMinutes.min}
        max={BOOKING_POLICY_LIMITS.minLeadMinutes.max}
        value={input.minLeadMinutes}
        description={describeMinLead(input.minLeadMinutes)}
        error={errors.minLeadMinutes}
        onChange={(next) => update({ minLeadMinutes: next })}
      />

      <PolicyField
        id="cancel-deadline-minutes"
        changed={changedFields.includes("cancelDeadlineMinutes")}
        label="キャンセル締切"
        unit="分"
        min={BOOKING_POLICY_LIMITS.cancelDeadlineMinutes.min}
        max={BOOKING_POLICY_LIMITS.cancelDeadlineMinutes.max}
        value={input.cancelDeadlineMinutes}
        description={describeCancelDeadline(input.cancelDeadlineMinutes)}
        error={errors.cancelDeadlineMinutes}
        onChange={(next) => update({ cancelDeadlineMinutes: next })}
      />

      <SectionFooter
        isPending={isPending}
        isDirty={isDirty}
        message={message}
        saved={saved}
        onSave={handleSave}
        onRevert={handleRevert}
      />
    </section>
  );
}

/**
 * 予約ポリシーの入力欄1つ。
 * 補足文(description)は入力中の値から純粋関数が組み立てたもので、
 * 値が数値として読めないあいだは null になり、補足そのものを出さない。
 */
function PolicyField({
  id,
  label,
  unit,
  min,
  max,
  value,
  description,
  error,
  changed,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  value: string;
  description: string | null;
  error: string | undefined;
  /** 保存済みの値から変わっているか(変更箇所の目印を出す) */
  changed: boolean;
  onChange: (value: string) => void;
}) {
  const describedBy = description === null ? undefined : `${id}-description`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className={fieldLabelClass}>
          {label}
        </label>
        {changed && <ChangedMark />}
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClass, "w-28")}
        />
        <span className="text-base text-foreground">{unit}</span>
      </div>
      {description !== null && (
        <p id={describedBy} className="text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
