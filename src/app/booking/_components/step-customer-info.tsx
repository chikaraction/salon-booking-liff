// 初回情報入力(初回のみ・確認の前)。お名前・電話番号の2項目。表示のみ。
// バリデーションはウィザード側で src/lib/booking.ts の validateCustomerInfo を使う。

import type { CustomerInfoErrors } from "@/lib/booking";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  phone: string;
  errors: CustomerInfoErrors;
  onChangeName: (value: string) => void;
  onChangePhone: (value: string) => void;
};

export function StepCustomerInfo({
  name,
  phone,
  errors,
  onChangeName,
  onChangePhone,
}: Props) {
  return (
    <div className="flex flex-col gap-5">
      <Field
        id="customer-name"
        label="お名前"
        value={name}
        error={errors.name}
        autoComplete="name"
        onChange={onChangeName}
      />
      <Field
        id="customer-phone"
        label="電話番号"
        value={phone}
        error={errors.phone}
        type="tel"
        autoComplete="tel"
        caption="当日のご連絡に使用します"
        onChange={onChangePhone}
      />
      <p className="rounded-xl bg-accent p-4 text-base text-primary-strong">
        LINEアカウントと紐づくため、次回以降はログインだけで予約できます。
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  error,
  caption,
  type = "text",
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  caption?: string;
  type?: string;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-base font-bold">
        {label}
        {/* 必須マーク */}
        <span aria-hidden="true" className="ml-0.5 text-destructive">
          *
        </span>
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "mt-2 h-12 w-full rounded-xl border bg-card px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
          error !== undefined ? "border-destructive" : "border-input",
        )}
      />
      {error !== undefined && (
        <p className="mt-1 text-sm text-destructive">{error}</p>
      )}
      {caption !== undefined && (
        <p className="mt-1 text-sm text-muted-foreground">{caption}</p>
      )}
    </div>
  );
}
