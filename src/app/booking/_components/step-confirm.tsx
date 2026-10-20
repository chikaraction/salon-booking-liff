// STEP 4: 内容の確認。選択内容のまとめと「ご要望・ご相談(任意)」の入力。表示のみ。

import { formatJstDateTimeLabel, formatYen } from "@/lib/booking";

type Props = {
  menus: Array<{ id: string; name: string; price: number }>;
  staffLabel: string;
  startISO: string;
  totalPrice: number;
  totalDurationMinutes: number;
  note: string;
  onChangeNote: (value: string) => void;
};

export function StepConfirm({
  menus,
  staffLabel,
  startISO,
  totalPrice,
  totalDurationMinutes,
  note,
  onChangeNote,
}: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-2xl bg-card">
        <section className="border-b border-border p-4">
          <h2 className="text-sm text-muted-foreground">メニュー</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {menus.map((menu) => (
              <li
                key={menu.id}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-base font-bold">{menu.name}</span>
                <span className="text-base">{formatYen(menu.price)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="border-b border-border p-4">
          <h2 className="text-sm text-muted-foreground">スタッフ</h2>
          <p className="mt-2 text-base font-bold">{staffLabel}</p>
        </section>
        <section className="p-4">
          <h2 className="text-sm text-muted-foreground">日時</h2>
          <p className="mt-2 text-base font-bold">
            {formatJstDateTimeLabel(new Date(startISO))}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            所要時間 約{totalDurationMinutes}分
          </p>
        </section>
        {/* 合計(強調) */}
        <section className="flex items-baseline justify-between bg-accent p-4">
          <h2 className="text-base font-bold text-primary-strong">合計</h2>
          <p className="text-2xl font-bold text-primary-strong">
            {formatYen(totalPrice)}
          </p>
        </section>
      </div>

      <div>
        <label htmlFor="booking-note" className="text-base font-bold">
          ご要望・ご相談
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            (任意)
          </span>
        </label>
        <textarea
          id="booking-note"
          value={note}
          rows={3}
          onChange={(event) => onChangeNote(event.target.value)}
          className="mt-2 w-full rounded-xl border border-input bg-card p-4 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <p className="mt-1 text-sm text-muted-foreground">
          入力内容は店側の予約詳細にメモとして表示されます
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        前日にLINEでリマインドをお送りします。ご都合が変わった場合は「マイ予約」から変更・キャンセルできます。
      </p>
    </div>
  );
}
