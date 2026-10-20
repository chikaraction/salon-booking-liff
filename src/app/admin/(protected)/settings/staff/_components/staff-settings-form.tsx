"use client";

// スタッフ設定フォーム(モックE)。
// 配線に徹する: 入力の検証・表示文言の組み立ては src/lib/staff-settings.ts の
// 純粋関数が担い、ここは状態とServer Actionの呼び出しだけ。
//
// モックEは「1人ぶんのカード」しか描かれていないが、実際にはスタッフが複数いる。
// そこで「スタッフを選ぶ導線 + 選んだスタッフのカード」という構成にした。
// 選び方をチップ(横並びのボタン)にしたのは、既存の設定画面(定休日の曜日チップ・
// 臨時休業の区分トグル)と同じ操作感で、人数が数人という前提に対して
// タブより折り返しに強く、スマホ幅でもそのまま並ぶため。
//
// 節ごとに保存ボタンを持たせている(1つの巨大なフォームにしない)。
// 営業日・営業時間の設定画面と同じ作法。

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  addStaffBlock,
  deleteStaffBlock,
  saveStaff,
  saveStaffWorkingHours,
} from "@/app/admin/(protected)/settings/actions";
import {
  ChangedMark,
  RevertButton,
  SectionFooter,
  UnsavedBadge,
  changedRowClass,
  useSavedDraft,
} from "@/app/admin/(protected)/settings/_components/unsaved-changes";
import { Button } from "@/components/ui/button";
import type { StaffRole } from "@/lib/admin-permissions";
import { weekdayLongLabel, weekdayShortLabel } from "@/lib/business-settings";
import {
  applyTimesToWorkingDays,
  changedStaffFields,
  changedWorkingDayWeekdays,
  describeStaffBlocks,
  describeStaffLogin,
  resolveStaffBlockRange,
  staffBlockLabel,
  staffHeadingLabel,
  staffRoleLabel,
  validateStaffInput,
  validateStaffWorkingHours,
  type StaffBlockErrors,
  type StaffBlockInput,
  type StaffBlockView,
  type StaffErrors,
  type StaffInput,
  type WorkingDayInput,
} from "@/lib/staff-settings";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const sectionLabelClass = "text-base font-bold text-muted-foreground";
const saveButtonClass = "h-11 rounded-xl px-5 text-base";
/**
 * 未選択のチップ・トグル(スタッフ選択・勤務曜日・臨時休の終日/時間指定)。地はモックの
 * #f2f0ea(--secondary)、文字は補足の文字色(--muted-foreground、地の上で約4.9:1。
 * モックの #7b818d は AA 未満なので使わない)。hover は地を少し濃くする
 * (button.tsx の secondary variant と同じ式。5% だと文字が 4.41:1 で AA を割るので
 * 3% にして 4.58:1)。hover:bg-muted だと地より明るくなり、濃さの変化が逆になる
 */
const unselectedChipClass =
  "bg-secondary text-muted-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_3%)]";
const fieldLabelClass = "text-sm font-bold text-foreground";

/** 選べるロール(staff.role の check 制約と同じ2値) */
const ROLE_CHOICES: readonly StaffRole[] = ["owner", "staff"];

/** 画面が扱うスタッフ1人ぶん(サーバーで組み立ててそのまま渡す) */
export type StaffCard = {
  id: string;
  name: string;
  role: StaffRole;
  displayOrder: number;
  isActive: boolean;
  bio: string | null;
  /** 管理画面ユーザーと紐付いているか(補足文の出し分けだけに使う) */
  hasAuthUser: boolean;
  /** 日曜〜土曜の7件 */
  workingDays: WorkingDayInput[];
  /** 今後の臨時休(日付順) */
  blocks: StaffBlockView[];
};

type Props = {
  /** 今日(JSTの暦日)。臨時休の日付入力の初期値に使う */
  today: string;
  staff: StaffCard[];
};

export function StaffSettingsForm({ today, staff }: Props) {
  // 既定は先頭(表示順のいちばん上)のスタッフ
  const [selectedId, setSelectedId] = useState<string | null>(
    staff[0]?.id ?? null,
  );
  const [isAdding, setIsAdding] = useState(false);

  const selected = staff.find((member) => member.id === selectedId) ?? null;
  // 新規スタッフの表示順は既存の最大 + 1(末尾に並ぶ)
  const nextDisplayOrder =
    staff.reduce((max, member) => Math.max(max, member.displayOrder), -1) + 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-6 md:p-8">
          <h1 className="text-2xl font-bold text-foreground">スタッフ</h1>
          {/* 1文ごとに <p> を分ける。JSXは行途中の改行を半角スペースに畳むため、
              1つの <p> の中で日本語を折り返すと文中に空きができてしまう
              (settings/layout.tsx と同じ作法) */}
          <p className="mt-2 text-base text-muted-foreground">
            スタッフごとに勤務曜日・時間・休憩と、臨時休を設定します。<br></br>
            勤務の設定はお客様の予約画面の空き枠にそのまま反映されます。
          </p>
        </div>

        <div className="flex flex-col gap-8 p-6 md:p-8">
          {/* スタッフを選ぶ導線(モックには無い。複数人いるため) */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={sectionLabelClass}>スタッフを選ぶ</p>
              <Button
                type="button"
                variant="outline"
                aria-expanded={isAdding}
                onClick={() => setIsAdding((open) => !open)}
                className="h-11 rounded-xl px-4 text-base"
              >
                <Plus aria-hidden="true" className="size-4" />
                スタッフを追加
              </Button>
            </div>

            {staff.length === 0 ? (
              <p className="text-base text-muted-foreground">
                スタッフが登録されていません。「スタッフを追加」から登録してください。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {staff.map((member) => {
                  const active = member.id === selectedId;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedId(member.id);
                        setIsAdding(false);
                      }}
                      className={cn(
                        // モックのトグル・チップ類は選択中・未選択とも font-weight:700
                        "h-11 rounded-xl px-4 text-base font-bold transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : unselectedChipClass,
                        !member.isActive && "line-through",
                      )}
                    >
                      {member.name}
                      {!member.isActive && (
                        <span className="ml-2 text-xs no-underline">無効</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {isAdding && (
            <StaffEditorSection
              key="new-staff"
              staff={null}
              defaultDisplayOrder={nextDisplayOrder}
              onFinished={() => setIsAdding(false)}
            />
          )}

          {selected !== null && (
            // スタッフを切り替えたら各節の状態(編集中の値)を捨てる
            <StaffCardSection
              key={selected.id}
              today={today}
              staff={selected}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 選んだスタッフのカード(モックE本体)
// ---------------------------------------------------------------------------

function StaffCardSection({
  today,
  staff,
}: {
  today: string;
  staff: StaffCard;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {staffHeadingLabel({ name: staff.name, role: staff.role })}
          </h2>
          <p className="mt-1 text-base text-muted-foreground">
            勤務・休憩・臨時休の設定
          </p>
          {!staff.isActive && (
            <p className="mt-2 text-sm text-destructive">
              このスタッフは無効です。お客様の予約画面には表示されません。
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          aria-expanded={isEditing}
          onClick={() => setIsEditing((open) => !open)}
          className="h-11 rounded-xl px-4 text-base"
        >
          スタッフ情報を編集
        </Button>
      </section>

      {isEditing && (
        <StaffEditorSection
          staff={staff}
          defaultDisplayOrder={staff.displayOrder}
          onFinished={() => setIsEditing(false)}
        />
      )}

      <WorkingHoursSection staffId={staff.id} workingDays={staff.workingDays} />
      <BlockSection today={today} staffId={staff.id} blocks={staff.blocks} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// スタッフ行の追加・編集(staff)
// ---------------------------------------------------------------------------

function StaffEditorSection({
  staff,
  defaultDisplayOrder,
  onFinished,
}: {
  /** 編集対象。null なら新規追加 */
  staff: StaffCard | null;
  defaultDisplayOrder: number;
  onFinished: () => void;
}) {
  const router = useRouter();
  // 保存済みの値(props)から組んだ入力が基準。新規追加(staff === null)は
  // 保存済みの値が無いので「未保存の変更」は見ない(従来どおり登録できる)
  const isTracked = staff !== null;
  const savedInput = useMemo<StaffInput>(
    () => ({
      name: staff?.name ?? "",
      role: staff?.role ?? "staff",
      displayOrder: String(staff?.displayOrder ?? defaultDisplayOrder),
      isActive: staff?.isActive ?? true,
      bio: staff?.bio ?? "",
    }),
    [staff, defaultDisplayOrder],
  );
  const {
    base,
    draft: input,
    setDraft: setInput,
    revert,
  } = useSavedDraft<StaffInput>(
    savedInput,
    (a, b) => changedStaffFields(a, b).length === 0,
  );
  const changedFields = isTracked ? changedStaffFields(base, input) : [];
  const isDirty = changedFields.length > 0;
  const [errors, setErrors] = useState<StaffErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // 「管理画面へのログイン」の補足文(状態で変わる部分)。判断は純粋関数に任せる
  const loginNote = describeStaffLogin(staff);

  const update = (patch: Partial<StaffInput>) => {
    setMessage(null);
    setInput((current) => ({ ...current, ...patch }));
  };

  const handleRevert = () => {
    setErrors({});
    setMessage(null);
    revert();
  };

  const handleSave = () => {
    setMessage(null);
    const validated = validateStaffInput(input);
    if (!validated.ok) {
      setErrors(validated.errors);
      setMessage(validated.message);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveStaff({ id: staff?.id ?? null, input });
      if (result.ok) {
        // 成功したら編集フォームを閉じるので基準値の更新は要らない
        // (次に開いたときは新しい props から組み直す)
        onFinished();
        router.refresh();
        return;
      }
      // 「最後のオーナーは降格・無効化できない」もここに出る
      setMessage(result.message);
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className={sectionLabelClass}>
          {staff === null ? "スタッフを追加" : "スタッフ情報"}
        </p>
        {isDirty && <UnsavedBadge />}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="staff-name" className={fieldLabelClass}>
              名前
            </label>
            {changedFields.includes("name") && <ChangedMark />}
          </div>
          <input
            id="staff-name"
            type="text"
            value={input.name}
            onChange={(event) => update({ name: event.target.value })}
            className={cn(inputClass, "mt-1 w-full")}
          />
          {errors.name !== undefined && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="staff-role" className={fieldLabelClass}>
              ロール
            </label>
            {changedFields.includes("role") && <ChangedMark />}
          </div>
          <select
            id="staff-role"
            value={input.role}
            onChange={(event) => update({ role: event.target.value })}
            className={cn(inputClass, "mt-1 w-full")}
          >
            {ROLE_CHOICES.map((role) => (
              <option key={role} value={role}>
                {staffRoleLabel(role)}
              </option>
            ))}
          </select>
          {errors.role !== undefined && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errors.role}
            </p>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="staff-display-order" className={fieldLabelClass}>
              表示順{" "}
              <span className="font-normal text-muted-foreground">
                (小さいほど先)
              </span>
            </label>
            {changedFields.includes("displayOrder") && <ChangedMark />}
          </div>
          <input
            id="staff-display-order"
            type="number"
            min={0}
            step={1}
            value={input.displayOrder}
            onChange={(event) => update({ displayOrder: event.target.value })}
            className={cn(inputClass, "mt-1 w-full")}
          />
          {errors.displayOrder !== undefined && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errors.displayOrder}
            </p>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className={fieldLabelClass}>状態</p>
            {changedFields.includes("isActive") && <ChangedMark />}
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-2">
            <span className="text-base text-foreground">
              {input.isActive ? "有効" : "無効"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={input.isActive}
              aria-label="このスタッフを有効にする"
              onClick={() => update({ isActive: !input.isActive })}
              className={cn(
                "relative h-8 w-14 shrink-0 rounded-full transition-colors",
                input.isActive ? "bg-primary" : "bg-input",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1 size-6 rounded-full bg-card transition-all",
                  input.isActive ? "left-7" : "left-1",
                )}
              />
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="staff-bio" className={fieldLabelClass}>
            自己紹介{" "}
            <span className="font-normal text-muted-foreground">(任意)</span>
          </label>
          {changedFields.includes("bio") && <ChangedMark />}
        </div>
        <textarea
          id="staff-bio"
          rows={3}
          value={input.bio}
          onChange={(event) => update({ bio: event.target.value })}
          className={cn(
            inputClass,
            "mt-1 h-auto w-full resize-y py-2 leading-relaxed",
          )}
        />
      </div>

      {/* 退職などで使わなくなったスタッフは「無効」にする。物理削除は提供しない */}
      <p className="rounded-lg bg-accent px-4 py-3 text-sm text-primary-strong">
        スタッフの削除はできません。<br></br>
        過去の予約が参照しているため、使わなくなったスタッフは「無効」にしてください。
        <br></br>
        無効にすると空き枠・指名候補から外れ、過去の予約はそのまま残ります。
      </p>

      {/* 管理画面のログインアカウントは画面から作らない(ADR-005)。
          このアクション(saveStaff)が書くのは staff と staff_working_hours だけで、
          新規スタッフのログイン用の紐付けは未設定のまま。
          本文にテーブル名・列名・SQLや、ダッシュボードでの操作手順は書かない。
          この画面の読み手は店のオーナーで、アカウントを作る権限を持たないため、
          手順が伝わっても実行できる立場にない。画面では「この画面でできること」と
          「いまどうなっているか」「誰に頼めばよいか」までに留め、
          具体的な手順はREADMEに任せる
          (settings/layout.tsx の権限不足カードと同じ方針)。

          文中の名前は保存済みの値(props)を使う。編集中の入力値ではなく props
          にしたのは、この3文が述べているのが「保存済みのアカウントの状態」で、
          同じカードの見出し(「田中(オーナー)」)も props の名前だから。
          編集中に名前欄を書き換えると入力欄と文中の名前がずれるが、
          この文が指すのは保存済みのその人なので、ずれていても読み違えない。
          入力値を使うと、名前欄を空にしたとたんに文が壊れる。 */}
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p className={fieldLabelClass}>管理画面へのログイン</p>
        <p>
          この画面で設定できるのはスタッフの情報と勤務だけで、管理画面にログインできるアカウントは作られません。
        </p>
        <p>
          施術だけを担当し管理画面を使わないスタッフは、この画面の設定だけで完了です。
          <br></br>
          予約の指名候補に並び、勤務曜日として設定した曜日は空き枠の計算に入ります。
        </p>
        <p className="font-bold text-foreground">{loginNote.status}</p>
        {loginNote.action !== null && <p>{loginNote.action}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={handleSave}
          // 既存スタッフの編集では、変更が無いあいだ保存できない
          disabled={isPending || (isTracked && !isDirty)}
          className={saveButtonClass}
        >
          {isPending && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          {staff === null ? "登録する" : "保存する"}
        </Button>
        {isDirty && (
          <RevertButton disabled={isPending} onRevert={handleRevert} />
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={onFinished}
          className="h-11 rounded-xl px-4 text-base"
        >
          キャンセル
        </Button>
        {message !== null && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 勤務曜日・時間(staff_working_hours)
// ---------------------------------------------------------------------------

function WorkingHoursSection({
  staffId,
  workingDays,
}: {
  staffId: string;
  workingDays: WorkingDayInput[];
}) {
  const router = useRouter();
  // 保存済みの値(props)が基準。変更の有無・変更された曜日の判定は
  // 純粋関数(changedWorkingDayWeekdays)に任せる
  const {
    base,
    draft: days,
    setDraft: setDays,
    revert,
    markSaved,
  } = useSavedDraft<WorkingDayInput[]>(
    workingDays,
    (a, b) => changedWorkingDayWeekdays(a, b).length === 0,
  );
  const changedWeekdays = changedWorkingDayWeekdays(base, days);
  const isDirty = changedWeekdays.length > 0;
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const touch = () => {
    setSaved(false);
    setMessage(null);
  };

  const handleRevert = () => {
    touch();
    setErrors({});
    revert();
  };

  const update = (weekday: number, patch: Partial<WorkingDayInput>) => {
    touch();
    setDays((current) =>
      current.map((day) =>
        day.weekday === weekday ? { ...day, ...patch } : day,
      ),
    );
  };

  const workingDaysOnly = days.filter((day) => day.isWorking);
  const firstWorkingDay = workingDaysOnly[0];

  const handleSave = () => {
    touch();
    const validated = validateStaffWorkingHours(days);
    if (!validated.ok) {
      setErrors(validated.errors);
      setMessage(validated.message);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveStaffWorkingHours({ staffId, days });
      if (result.ok) {
        setSaved(true);
        // 保存した値が新しい基準になる(= 変更なしの状態に戻る)
        markSaved();
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className={sectionLabelClass}>勤務曜日・時間</p>
        {isDirty && <UnsavedBadge />}
      </div>

      {/* 曜日チップ。選択(塗り)= 勤務日(モックE準拠) */}
      <div className="flex flex-wrap gap-2">
        {days.map((day) => (
          <button
            key={day.weekday}
            type="button"
            aria-pressed={day.isWorking}
            onClick={() =>
              update(day.weekday, {
                isWorking: !day.isWorking,
                // 勤務日にしたばかりの曜日は、ほかの勤務日の時刻を初期値にする
                // (全曜日同じ時刻の店が大半なので入力の手間を減らす)
                ...(!day.isWorking && day.startTime === ""
                  ? {
                      startTime: firstWorkingDay?.startTime ?? "",
                      endTime: firstWorkingDay?.endTime ?? "",
                      breakStart: firstWorkingDay?.breakStart ?? "",
                      breakEnd: firstWorkingDay?.breakEnd ?? "",
                    }
                  : {}),
              })
            }
            className={cn(
              "h-12 w-14 rounded-xl text-base font-bold transition-colors",
              day.isWorking
                ? "bg-primary text-primary-foreground"
                : unselectedChipClass,
            )}
          >
            <span className="sr-only">
              {weekdayLongLabel(day.weekday)}
              {day.isWorking ? "(勤務)" : "(休み)"}
            </span>
            <span aria-hidden="true">{weekdayShortLabel(day.weekday)}</span>
          </button>
        ))}
      </div>

      {/* 休みにした曜日は下の入力欄が消えて行の目印が出せないので、
          変更した曜日をここで名前で挙げる */}
      {isDirty && (
        <p className="text-sm text-accent-foreground">
          未保存の変更:{" "}
          {changedWeekdays
            .map((weekday) => weekdayLongLabel(weekday))
            .join("・")}
        </p>
      )}

      {workingDaysOnly.length === 0 ? (
        <p className="text-base text-muted-foreground">
          勤務する曜日を選ぶと、開始・終了・休憩を設定できます。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* モックは「開始」「終了」「休憩」の3入力。DBは曜日ごとに1行なので
              曜日ごとに入力欄を出し、見出しは1回だけ(PC幅)にしてモックに寄せる */}
          <div className="hidden gap-3 text-sm text-muted-foreground md:grid md:grid-cols-[5rem_1fr_1fr_1.6fr]">
            <span>曜日</span>
            <span>開始</span>
            <span>終了</span>
            <span>休憩</span>
          </div>

          {workingDaysOnly.map((day) => (
            <div
              key={day.weekday}
              className={cn(
                "flex flex-col gap-1",
                // 触った曜日の行に目印を出す
                changedWeekdays.includes(day.weekday) && changedRowClass,
              )}
            >
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 md:grid-cols-[5rem_1fr_1fr_1.6fr] md:items-center md:gap-3 md:rounded-none md:border-0 md:p-0">
                <span className="flex flex-wrap items-center gap-2 text-base font-bold text-foreground md:font-normal">
                  {weekdayLongLabel(day.weekday)}
                  {changedWeekdays.includes(day.weekday) && <ChangedMark />}
                </span>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`start-${day.weekday}`}
                    className="text-sm text-muted-foreground md:hidden"
                  >
                    開始
                  </label>
                  <input
                    id={`start-${day.weekday}`}
                    type="time"
                    value={day.startTime}
                    onChange={(event) =>
                      update(day.weekday, { startTime: event.target.value })
                    }
                    className={cn(inputClass, "w-full")}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={`end-${day.weekday}`}
                    className="text-sm text-muted-foreground md:hidden"
                  >
                    終了
                  </label>
                  <input
                    id={`end-${day.weekday}`}
                    type="time"
                    value={day.endTime}
                    onChange={(event) =>
                      update(day.weekday, { endTime: event.target.value })
                    }
                    className={cn(inputClass, "w-full")}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground md:hidden">
                    休憩 <span className="text-xs">(なしの場合は両方空欄)</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <label
                      className="sr-only"
                      htmlFor={`break-start-${day.weekday}`}
                    >
                      {weekdayLongLabel(day.weekday)}の休憩開始
                    </label>
                    <input
                      id={`break-start-${day.weekday}`}
                      type="time"
                      value={day.breakStart}
                      onChange={(event) =>
                        update(day.weekday, { breakStart: event.target.value })
                      }
                      className={cn(inputClass, "w-full min-w-0")}
                    />
                    <span className="text-muted-foreground">〜</span>
                    <label
                      className="sr-only"
                      htmlFor={`break-end-${day.weekday}`}
                    >
                      {weekdayLongLabel(day.weekday)}の休憩終了
                    </label>
                    <input
                      id={`break-end-${day.weekday}`}
                      type="time"
                      value={day.breakEnd}
                      onChange={(event) =>
                        update(day.weekday, { breakEnd: event.target.value })
                      }
                      className={cn(inputClass, "w-full min-w-0")}
                    />
                  </div>
                </div>
              </div>
              {errors[day.weekday] !== undefined && (
                <p role="alert" className="text-sm text-destructive">
                  {weekdayLongLabel(day.weekday)}: {errors[day.weekday]}
                </p>
              )}
            </div>
          ))}

          {workingDaysOnly.length > 1 && firstWorkingDay !== undefined && (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  touch();
                  setDays((current) =>
                    applyTimesToWorkingDays(current, firstWorkingDay.weekday),
                  );
                }}
                className="h-11 rounded-xl px-4 text-base"
              >
                {weekdayLongLabel(firstWorkingDay.weekday)}
                と同じ時刻をすべての勤務日に適用
              </Button>
            </div>
          )}
        </div>
      )}

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
// 臨時休(reservations の kind='block')
// ---------------------------------------------------------------------------

function emptyBlockInput(today: string): StaffBlockInput {
  return { date: today, allDay: true, startTime: "", endTime: "" };
}

function BlockSection({
  today,
  staffId,
  blocks,
}: {
  today: string;
  staffId: string;
  blocks: StaffBlockView[];
}) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [input, setInput] = useState<StaffBlockInput>(() =>
    emptyBlockInput(today),
  );
  const [errors, setErrors] = useState<StaffBlockErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const update = (patch: Partial<StaffBlockInput>) => {
    setMessage(null);
    setInput((current) => ({ ...current, ...patch }));
  };

  const handleAdd = () => {
    setMessage(null);
    // 事前チェックは時間帯指定のときだけ行う。「終日」の時間帯はその日の実効勤務
    // 時間(定休曜日の臨時営業なども効く)から決まり、それを知っているのは
    // サーバー側なので、判定はサーバーの結果を待つ
    if (!input.allDay) {
      const validated = resolveStaffBlockRange({ input, workingDay: null });
      if (!validated.ok) {
        setErrors(validated.errors);
        return;
      }
    }
    setErrors({});
    startTransition(async () => {
      const result = await addStaffBlock({ staffId, input });
      if (result.ok) {
        setIsAdding(false);
        setInput(emptyBlockInput(today));
        router.refresh();
        return;
      }
      // 既存予約と重なったとき(23P01)のメッセージもここに出る
      setMessage(result.message);
    });
  };

  const handleDelete = (id: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteStaffBlock(id);
      if (result.ok) {
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  // 補足文「7月29日(水)は休診に設定済み」は登録内容から生成する
  const description = describeStaffBlocks(blocks);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-5 py-4">
        <div>
          <p className="text-base font-bold text-foreground">臨時休を追加</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {description ?? "登録された臨時休はありません"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline-accent"
          aria-expanded={isAdding}
          onClick={() => {
            setErrors({});
            setMessage(null);
            setIsAdding((open) => !open);
          }}
          className="h-11 shrink-0 rounded-xl px-4 text-base"
        >
          <Plus aria-hidden="true" className="size-4" />
          追加
        </Button>
      </div>

      {isAdding && (
        <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
          <div>
            <label htmlFor="block-date" className={fieldLabelClass}>
              日付
            </label>
            <input
              id="block-date"
              type="date"
              value={input.date}
              onChange={(event) => update({ date: event.target.value })}
              className={cn(inputClass, "mt-1 w-full sm:w-56")}
            />
            {errors.date !== undefined && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {errors.date}
              </p>
            )}
          </div>

          <fieldset>
            <legend className={fieldLabelClass}>範囲</legend>
            <div className="mt-2 flex gap-2">
              {[
                { allDay: true, label: "終日" },
                { allDay: false, label: "時間帯を指定" },
              ].map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  aria-pressed={input.allDay === choice.allDay}
                  onClick={() =>
                    update(
                      choice.allDay
                        ? { allDay: true, startTime: "", endTime: "" }
                        : { allDay: false },
                    )
                  }
                  className={cn(
                    "h-11 rounded-xl px-5 text-base font-bold transition-colors",
                    input.allDay === choice.allDay
                      ? "bg-primary text-primary-foreground"
                      : unselectedChipClass,
                  )}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              終日はその日の勤務時間ぜんぶを休みにします。<br></br>
              勤務の無い曜日は時間帯を指定してください。
            </p>
          </fieldset>

          {!input.allDay && (
            <div>
              <p className={fieldLabelClass}>時間帯</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="block-start">
                  臨時休の開始時刻
                </label>
                <input
                  id="block-start"
                  type="time"
                  value={input.startTime}
                  onChange={(event) =>
                    update({ startTime: event.target.value })
                  }
                  className={cn(inputClass, "w-32")}
                />
                <span className="text-muted-foreground">〜</span>
                <label className="sr-only" htmlFor="block-end">
                  臨時休の終了時刻
                </label>
                <input
                  id="block-end"
                  type="time"
                  value={input.endTime}
                  onChange={(event) => update({ endTime: event.target.value })}
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

      {/* 終日の臨時休を勤務の無い日に登録しようとした場合のエラーもここに出る */}
      {message !== null && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      {blocks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {blocks.map((block) => (
            <li
              key={block.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted px-4 py-3"
            >
              <span className="text-base text-foreground">
                {staffBlockLabel(block)}
              </span>
              <button
                type="button"
                aria-label={`${staffBlockLabel(block)}の臨時休を削除`}
                disabled={isPending}
                onClick={() => handleDelete(block.id)}
                className="ml-auto flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-card hover:text-destructive disabled:opacity-50"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
