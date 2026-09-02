"use client";

// 営業日・営業時間の設定フォーム(モックE-2 + 曜日ごとの営業時間)。
// 配線に徹する: 入力の検証・表示文言の組み立ては src/lib/business-settings.ts
// と src/lib/closures.ts の純粋関数が担い、ここは状態とServer Actionの呼び出しだけ。
//
// 節ごとに保存ボタンを持たせている(1つの巨大なフォームにしない)。
// 毎週の定休日と曜日ごとの営業時間だけは同じ business_hours の行を編集するので
// 1つの節・1回の保存にまとめてある。
// 「祝日を休業にする」はモックがトグルなので、切り替えた時点で保存する。

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addDateOverride,
  deleteDateOverride,
  saveCloseOnHolidays,
  saveNthWeekdayClosures,
  saveWeeklyBusinessHours,
} from "@/app/admin/(protected)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  NTH_CHOICES,
  WEEKDAYS,
  describeNthWeekdayClosures,
  flattenNthWeekdayGroups,
  groupNthWeekdayClosures,
  validateDateOverride,
  validateWeeklyBusinessHours,
  weekdayLongLabel,
  weekdayShortLabel,
  type DateOverrideErrors,
  type DateOverrideInput,
  type NthWeekdayClosureRow,
  type NthWeekdayGroup,
  type WeeklyHoursInput,
} from "@/lib/business-settings";
import type { ClosureListItem } from "@/lib/closures";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const sectionLabelClass = "text-base font-bold text-muted-foreground";
const saveButtonClass = "h-11 rounded-xl px-5 text-base font-bold";

/** 一覧の1行(祝日行は overrideId が null = 削除できない) */
export type ClosureRow = {
  item: ClosureListItem;
  overrideId: string | null;
};

type Props = {
  /** 今日(JSTの暦日)。日付入力の初期値に使う */
  today: string;
  /** 日曜〜土曜の7件。時刻は "HH:MM"(未設定は空文字) */
  businessHours: WeeklyHoursInput[];
  nthWeekdayClosures: NthWeekdayClosureRow[];
  closeOnHolidays: boolean;
  closureRows: ClosureRow[];
};

/** バッジの見た目。自動導出の祝日(休業)と連休は淡いグレー、臨時休・臨時営業は淡いモーヴ */
function badgeClass(badge: ClosureListItem["badge"]): string {
  return badge === "臨時休" || badge === "臨時営業"
    ? "bg-accent text-accent-foreground"
    : "bg-secondary text-secondary-foreground";
}

export function BusinessSettingsForm({
  today,
  businessHours,
  nthWeekdayClosures,
  closeOnHolidays,
  closureRows,
}: Props) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="border-b border-border p-6 md:p-8">
          <h1 className="text-2xl font-bold text-foreground">定休日・祝日</h1>
          <p className="mt-2 text-base text-muted-foreground">
            休業日を登録すると、その日はお客様の予約画面に表示されず、予約を受け付けません(予約枠が開かない)。
          </p>
        </div>

        <div className="flex flex-col gap-10 p-6 md:p-8">
          <WeeklyHoursSection businessHours={businessHours} />
          <NthWeekdaySection nthWeekdayClosures={nthWeekdayClosures} />
          <HolidaySection closeOnHolidays={closeOnHolidays} />
          <DateOverrideSection
            today={today}
            businessHours={businessHours}
            closureRows={closureRows}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 毎週の定休日 + 曜日ごとの営業時間(business_hours)
// ---------------------------------------------------------------------------

function WeeklyHoursSection({
  businessHours,
}: {
  businessHours: WeeklyHoursInput[];
}) {
  const router = useRouter();
  const [days, setDays] = useState<WeeklyHoursInput[]>(businessHours);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const update = (weekday: number, patch: Partial<WeeklyHoursInput>) => {
    setSaved(false);
    setDays((current) =>
      current.map((day) =>
        day.weekday === weekday ? { ...day, ...patch } : day,
      ),
    );
  };

  const handleSave = () => {
    setMessage(null);
    setSaved(false);
    const validated = validateWeeklyBusinessHours(days);
    if (!validated.ok) {
      setErrors(validated.errors);
      setMessage(validated.message);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveWeeklyBusinessHours(days);
      if (result.ok) {
        setSaved(true);
        // 休業日ルールが変わると下の一覧(サーバーで組み立て)も変わる
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <p className={sectionLabelClass}>
        毎週の定休日{" "}
        <span className="text-sm font-normal">(毎週固定で休む曜日)</span>
      </p>

      <div className="flex flex-wrap gap-2">
        {days.map((day) => {
          const isClosed = !day.isOpen;
          return (
            <button
              key={day.weekday}
              type="button"
              aria-pressed={isClosed}
              onClick={() => update(day.weekday, { isOpen: !day.isOpen })}
              className={cn(
                "h-12 w-14 rounded-xl text-base font-medium transition-colors",
                isClosed
                  ? "bg-primary font-bold text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-muted",
              )}
            >
              <span className="sr-only">
                {weekdayLongLabel(day.weekday)}
                {isClosed ? "(定休)" : "(営業)"}
              </span>
              <span aria-hidden="true">{weekdayShortLabel(day.weekday)}</span>
            </button>
          );
        })}
      </div>

      {/* モック外の追加: 営業する曜日の開店・閉店時刻(ADR-007 で店舗固有値を
          コードに書けないため、DBの business_hours を編集する口が要る) */}
      <div className="mt-2 flex flex-col gap-3">
        <p className={sectionLabelClass}>
          曜日ごとの営業時間{" "}
          <span className="text-sm font-normal">
            (定休の曜日は入力できません)
          </span>
        </p>
        {days.map((day) => (
          <div key={day.weekday} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "w-16 shrink-0 text-base",
                  day.isOpen ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {weekdayLongLabel(day.weekday)}
              </span>
              <label className="sr-only" htmlFor={`open-${day.weekday}`}>
                {weekdayLongLabel(day.weekday)}の開店時刻
              </label>
              <input
                id={`open-${day.weekday}`}
                type="time"
                value={day.openTime}
                disabled={!day.isOpen}
                onChange={(event) =>
                  update(day.weekday, { openTime: event.target.value })
                }
                className={cn(inputClass, "w-32")}
              />
              <span className="text-muted-foreground">〜</span>
              <label className="sr-only" htmlFor={`close-${day.weekday}`}>
                {weekdayLongLabel(day.weekday)}の閉店時刻
              </label>
              <input
                id={`close-${day.weekday}`}
                type="time"
                value={day.closeTime}
                disabled={!day.isOpen}
                onChange={(event) =>
                  update(day.weekday, { closeTime: event.target.value })
                }
                className={cn(inputClass, "w-32")}
              />
              {!day.isOpen && (
                <span className="text-sm text-muted-foreground">定休</span>
              )}
            </div>
            {errors[day.weekday] !== undefined && (
              <p role="alert" className="text-sm text-destructive">
                {errors[day.weekday]}
              </p>
            )}
          </div>
        ))}
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
// 特定の週だけの定休日(nth_weekday_closures)
// ---------------------------------------------------------------------------

function NthWeekdaySection({
  nthWeekdayClosures,
}: {
  nthWeekdayClosures: NthWeekdayClosureRow[];
}) {
  const router = useRouter();
  const [groups, setGroups] = useState<NthWeekdayGroup[]>(() =>
    groupNthWeekdayClosures(nthWeekdayClosures),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const touch = () => {
    setSaved(false);
    setMessage(null);
  };

  const updateGroup = (index: number, patch: Partial<NthWeekdayGroup>) => {
    touch();
    setGroups((current) =>
      current.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    );
  };

  const toggleNth = (index: number, nth: number) => {
    const group = groups[index];
    updateGroup(index, {
      nths: group.nths.includes(nth)
        ? group.nths.filter((value) => value !== nth)
        : [...group.nths, nth].sort((a, b) => a - b),
    });
  };

  const handleSave = () => {
    touch();
    startTransition(async () => {
      const result = await saveNthWeekdayClosures(groups);
      if (result.ok) {
        // 空のブロック・重複は保存時に落ちるので、画面も同じ形に揃える
        setGroups(groupNthWeekdayClosures(flattenNthWeekdayGroups(groups)));
        setSaved(true);
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  // 補足文は設定内容から生成する(文言はハードコードしない)
  const description = describeNthWeekdayClosures(
    flattenNthWeekdayGroups(groups),
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={sectionLabelClass}>
          特定の週だけの定休日{" "}
          <span className="text-sm font-normal">(第◯曜日・隔週など)</span>
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            touch();
            setGroups((current) => [...current, { weekday: 0, nths: [] }]);
          }}
          className="h-11 rounded-xl px-4 text-base font-medium"
        >
          <Plus aria-hidden="true" className="size-4" />
          追加
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="text-base text-muted-foreground">
          第◯曜日の定休は登録されていません。
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-3 md:p-4">
          {groups.map((group, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 md:gap-3"
            >
              <label className="sr-only" htmlFor={`nth-weekday-${index}`}>
                定休にする曜日
              </label>
              <select
                id={`nth-weekday-${index}`}
                value={group.weekday}
                onChange={(event) =>
                  updateGroup(index, { weekday: Number(event.target.value) })
                }
                className={cn(inputClass, "w-32")}
              >
                {WEEKDAYS.map((weekday) => (
                  <option key={weekday} value={weekday}>
                    {weekdayLongLabel(weekday)}
                  </option>
                ))}
              </select>
              <span className="text-base text-muted-foreground">の</span>
              <div className="flex flex-wrap gap-2">
                {NTH_CHOICES.map((nth) => {
                  const selected = group.nths.includes(nth);
                  return (
                    <button
                      key={nth}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleNth(index, nth)}
                      className={cn(
                        "h-11 w-14 rounded-xl text-base transition-colors",
                        selected
                          ? "bg-primary font-bold text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-muted",
                      )}
                    >
                      第{nth}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                aria-label={`${weekdayLongLabel(group.weekday)}の設定を削除`}
                onClick={() => {
                  touch();
                  setGroups((current) => current.filter((_, i) => i !== index));
                }}
                className="ml-auto flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              >
                <Trash2 aria-hidden="true" className="size-5" />
              </button>
            </div>
          ))}

          {description !== null && (
            <p className="rounded-lg bg-accent px-4 py-3 text-sm text-accent-foreground">
              {description}
            </p>
          )}
        </div>
      )}

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
// 祝日を休業にする(salon_settings.close_on_holidays)
// ---------------------------------------------------------------------------

function HolidaySection({ closeOnHolidays }: { closeOnHolidays: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(closeOnHolidays);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    setMessage(null);
    startTransition(async () => {
      const result = await saveCloseOnHolidays(next);
      if (result.ok) {
        // 祝日行は一覧に自動導出で出るので再取得する
        router.refresh();
        return;
      }
      // 保存できなかったら表示を元に戻す(ONに見えるのに休業にならない事故を防ぐ)
      setEnabled(!next);
      setMessage(result.message);
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4 rounded-xl bg-muted px-5 py-4">
        <div>
          <p className="text-base font-bold text-foreground">
            祝日を休業にする
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            日本の祝日を自動で休業扱いにします
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="祝日を休業にする"
          disabled={isPending}
          onClick={handleToggle}
          className={cn(
            "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
            enabled ? "bg-primary" : "bg-input",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1 size-6 rounded-full bg-card transition-all",
              enabled ? "left-7" : "left-1",
            )}
          />
        </button>
      </div>
      {message !== null && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 臨時休業・指定日(date_overrides)
// ---------------------------------------------------------------------------

function emptyOverrideInput(today: string): DateOverrideInput {
  return {
    startDate: today,
    endDate: today,
    isOpen: false,
    label: "",
    openTime: "",
    closeTime: "",
  };
}

function DateOverrideSection({
  today,
  businessHours,
  closureRows,
}: {
  today: string;
  businessHours: WeeklyHoursInput[];
  closureRows: ClosureRow[];
}) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [input, setInput] = useState<DateOverrideInput>(() =>
    emptyOverrideInput(today),
  );
  const [errors, setErrors] = useState<DateOverrideErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 「定休曜日を含む臨時営業は営業時間必須」の判定に使う。保存済みの値
  // (props)で判定する。未保存の編集中の値ではサーバーの判定とずれるため
  const closedWeekdays = businessHours
    .filter((day) => !day.isOpen)
    .map((day) => day.weekday);

  const update = (patch: Partial<DateOverrideInput>) => {
    setMessage(null);
    setInput((current) => ({ ...current, ...patch }));
  };

  const handleAdd = () => {
    setMessage(null);
    const validated = validateDateOverride({ input, closedWeekdays });
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await addDateOverride(input);
      if (result.ok) {
        setIsAdding(false);
        setInput(emptyOverrideInput(today));
        // 一覧はサーバーで組み立てているので再取得する
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  const handleDelete = (id: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteDateOverride(id);
      if (result.ok) {
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={sectionLabelClass}>臨時休業・指定日</p>
        <Button
          type="button"
          variant="outline"
          aria-expanded={isAdding}
          onClick={() => {
            setErrors({});
            setMessage(null);
            setIsAdding((open) => !open);
          }}
          className="h-11 rounded-xl px-4 text-base font-medium"
        >
          <Plus aria-hidden="true" className="size-4" />
          日付を追加
        </Button>
      </div>

      {isAdding && (
        <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="override-start"
                className="text-sm font-bold text-foreground"
              >
                開始日
              </label>
              <input
                id="override-start"
                type="date"
                value={input.startDate}
                onChange={(event) => {
                  const startDate = event.target.value;
                  // 単日の登録が普通なので、終了日は開始日に追従させる
                  update(
                    input.endDate < startDate
                      ? { startDate, endDate: startDate }
                      : { startDate },
                  );
                }}
                className={cn(inputClass, "mt-1 w-full")}
              />
              {errors.startDate !== undefined && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {errors.startDate}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="override-end"
                className="text-sm font-bold text-foreground"
              >
                終了日{" "}
                <span className="font-normal text-muted-foreground">
                  (単日は開始日と同じ)
                </span>
              </label>
              <input
                id="override-end"
                type="date"
                value={input.endDate}
                onChange={(event) => update({ endDate: event.target.value })}
                className={cn(inputClass, "mt-1 w-full")}
              />
              {errors.endDate !== undefined && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {errors.endDate}
                </p>
              )}
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-bold text-foreground">区分</legend>
            <div className="mt-2 flex gap-2">
              {[
                { isOpen: false, label: "休業" },
                { isOpen: true, label: "臨時営業" },
              ].map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  aria-pressed={input.isOpen === choice.isOpen}
                  onClick={() =>
                    // 休業は時刻を持てない(date_overrides_closed_has_no_times)
                    update(
                      choice.isOpen
                        ? { isOpen: true }
                        : { isOpen: false, openTime: "", closeTime: "" },
                    )
                  }
                  className={cn(
                    "h-11 rounded-xl px-5 text-base transition-colors",
                    input.isOpen === choice.isOpen
                      ? "bg-primary font-bold text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-muted",
                  )}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="override-label"
              className="text-sm font-bold text-foreground"
            >
              ラベル{" "}
              <span className="font-normal text-muted-foreground">(任意)</span>
            </label>
            <input
              id="override-label"
              type="text"
              value={input.label}
              placeholder="夏季休業"
              onChange={(event) => update({ label: event.target.value })}
              className={cn(inputClass, "mt-1 w-full")}
            />
          </div>

          {/* 営業時間は臨時営業のときだけ入力できる */}
          {input.isOpen && (
            <div>
              <p className="text-sm font-bold text-foreground">
                営業時間{" "}
                <span className="font-normal text-muted-foreground">
                  (定休の曜日を含む場合は必須)
                </span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="override-open">
                  臨時営業の開店時刻
                </label>
                <input
                  id="override-open"
                  type="time"
                  value={input.openTime}
                  onChange={(event) => update({ openTime: event.target.value })}
                  className={cn(inputClass, "w-32")}
                />
                <span className="text-muted-foreground">〜</span>
                <label className="sr-only" htmlFor="override-close">
                  臨時営業の閉店時刻
                </label>
                <input
                  id="override-close"
                  type="time"
                  value={input.closeTime}
                  onChange={(event) =>
                    update({ closeTime: event.target.value })
                  }
                  className={cn(inputClass, "w-32")}
                />
              </div>
              {errors.time !== undefined && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {errors.time}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleAdd}
              disabled={isPending}
              className={saveButtonClass}
            >
              {isPending && (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              )}
              登録する
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsAdding(false)}
              className="h-11 rounded-xl px-4 text-base"
            >
              キャンセル
            </Button>
          </div>
        </div>
      )}

      {message !== null && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      {closureRows.length === 0 ? (
        <p className="text-base text-muted-foreground">
          今後の臨時休業・指定日はありません。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {closureRows.map((row, index) => {
            const overrideId = row.overrideId;
            return (
              <li
                key={overrideId ?? `holiday-${index}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted px-4 py-3"
              >
                <span className="text-base font-bold text-foreground">
                  {row.item.dateRangeLabel}
                </span>
                {row.item.label !== "" && (
                  <span className="text-sm text-muted-foreground">
                    {row.item.label}
                  </span>
                )}
                <span
                  className={cn(
                    "ml-auto rounded-full px-3 py-1 text-xs font-bold",
                    badgeClass(row.item.badge),
                  )}
                >
                  {row.item.badge}
                </span>
                {/* 祝日行は自動導出なので削除できない(トグルで一括して切り替える) */}
                {overrideId !== null && (
                  <button
                    type="button"
                    aria-label={`${row.item.dateRangeLabel}の登録を削除`}
                    disabled={isPending}
                    onClick={() => handleDelete(overrideId)}
                    className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-card hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 節の保存ボタン(共通)
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
