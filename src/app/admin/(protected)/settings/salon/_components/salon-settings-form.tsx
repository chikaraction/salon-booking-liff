"use client";

// 店舗・予約設定のフォーム(モックなし。既存の設定画面と同じトーンで組む)。
// 配線に徹する: 入力の検証・補足文の組み立ては src/lib/salon-settings.ts の
// 純粋関数が担い、ここは状態とServer Actionの呼び出しだけ。
//
// 節ごとに保存ボタンを持たせる(営業日設定と同じ作法)。店名と予約ポリシーは
// 同じ salon_settings の行だが、変わったときの影響先が別(店名=管理画面の
// 見出し、ポリシー=客側の枠)なので、節も保存も分けている。

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  saveBookingPolicy,
  saveSalonName,
} from "@/app/admin/(protected)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  BOOKING_POLICY_LIMITS,
  SALON_NAME_MAX_LENGTH,
  describeBookingWindow,
  describeCancelDeadline,
  describeMinLead,
  describeSlotInterval,
  validateBookingPolicyInput,
  validateSalonName,
  type BookingPolicyErrors,
  type BookingPolicyInput,
} from "@/lib/salon-settings";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const fieldLabelClass = "text-base font-bold text-foreground";
const saveButtonClass = "h-11 rounded-xl px-5 text-base font-bold";

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
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

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
        <label htmlFor="salon-name" className={fieldLabelClass}>
          店名
        </label>
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
        message={message}
        saved={saved}
        onSave={handleSave}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 予約の受付ルール(刻み・受付期間・直前締切・キャンセル締切)
// ---------------------------------------------------------------------------

function BookingPolicySection({ policy }: { policy: BookingPolicyInput }) {
  const router = useRouter();
  const [input, setInput] = useState<BookingPolicyInput>(policy);
  const [errors, setErrors] = useState<BookingPolicyErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const update = (patch: Partial<BookingPolicyInput>) => {
    setSaved(false);
    setMessage(null);
    setInput((current) => ({ ...current, ...patch }));
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
        message={message}
        saved={saved}
        onSave={handleSave}
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
  onChange: (value: string) => void;
}) {
  const describedBy = description === null ? undefined : `${id}-description`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
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

// ---------------------------------------------------------------------------
// 節の保存ボタン(営業日設定のフッターと同じ形)
// ---------------------------------------------------------------------------

function SectionFooter({
  isPending,
  message,
  saved,
  onSave,
}: {
  isPending: boolean;
  message: string | null;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        onClick={onSave}
        disabled={isPending}
        className={saveButtonClass}
      >
        {isPending && (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        )}
        保存する
      </Button>
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          保存しました
        </p>
      )}
      {message !== null && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
