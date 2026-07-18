"use client";

// 代行登録フォーム(電話予約用・モックD)。配線に徹する:
// 入力検証は src/lib/admin-reservation-form.ts、空き判定は
// src/lib/admin-calendar.ts、RPC呼び出しは Server Action が担う。
// - お客様名は検索型(入力→候補→選択で既存顧客を確定、候補になければ新規客)
// - メニューは複数選択(データモデルに合わせる。モックは単一だが複数可)
// - スタッフ・日付・時間が揃うと空き状況を表示する(補助表示。最後の砦は
//   DBのEXCLUDE制約: ADR-004)

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  checkProxySlot,
  createProxyReservation,
  searchCustomersAction,
  updateAdminReservation,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import type { ProxyRegistrationErrors } from "@/lib/admin-reservation-form";
import { formatYen, summarizeSelectedMenus } from "@/lib/booking";
import type { AdminStaff, SlotAvailability } from "@/lib/admin-calendar";
import type { ActiveMenu, CustomerSearchResult } from "@/server/admin-data";
import { cn } from "@/lib/utils";

const inputClass =
  "h-12 w-full rounded-xl border border-input bg-card px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";
const labelClass = "text-base font-bold";

/** 変更モードの初期値(既存予約から復元する) */
export type ReservationFormInitial = {
  menuIds: string[];
  staffId: string;
  /** JSTの暦日 "YYYY-MM-DD" */
  date: string;
  /** 壁時計時刻 "HH:MM" */
  time: string;
  note: string;
};

type Props = {
  staff: AdminStaff[];
  menus: ActiveMenu[];
  /** 日付の初期値(今日・JST)。変更モードでは initial.date が優先される */
  defaultDate: string;
  /** "create"(既定・代行登録)/ "edit"(店側変更) */
  mode?: "create" | "edit";
  /** 変更モードの対象予約ID */
  reservationId?: string;
  /** 変更モードの初期値(既存予約から復元) */
  initial?: ReservationFormInitial;
  /** 変更モードで固定表示する顧客名(顧客は変更不可) */
  fixedCustomerName?: string;
};

export function ProxyRegistrationForm({
  staff,
  menus,
  defaultDate,
  mode = "create",
  reservationId,
  initial,
  fixedCustomerName,
}: Props) {
  const router = useRouter();
  const isEdit = mode === "edit";

  // 顧客(検索型): 選択済み既存顧客 or 検索クエリ(=新規客名)。
  // 変更モードでは顧客は固定のため使わない
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerSearchResult | null>(null);
  const [candidates, setCandidates] = useState<CustomerSearchResult[]>([]);
  const [newPhone, setNewPhone] = useState("");

  // 予約内容(変更モードは既存予約の値で初期化)
  const [menuIds, setMenuIds] = useState<string[]>(initial?.menuIds ?? []);
  const [staffId, setStaffId] = useState(initial?.staffId ?? "");
  const [date, setDate] = useState(initial?.date ?? defaultDate);
  const [time, setTime] = useState(initial?.time ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  // 空き表示・エラー・送信状態
  const [availability, setAvailability] = useState<SlotAvailability | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<ProxyRegistrationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  const menuById = new Map(menus.map((menu) => [menu.id, menu]));
  const selectedMenus = menuIds
    .map((id) => menuById.get(id))
    .filter((menu): menu is ActiveMenu => menu !== undefined);
  const summary = summarizeSelectedMenus(selectedMenus);

  // --- 顧客検索(入力をデバウンス) -----------------------------------------
  // 状態更新はすべて setTimeout のコールバック内で行う(effect本体での
  // 同期的な setState は cascading render を招くため避ける)。
  useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    const shouldSearch = selectedCustomer === null && q !== "";
    const timer = setTimeout(
      async () => {
        if (!shouldSearch) {
          setCandidates([]);
          return;
        }
        const result = await searchCustomersAction(q);
        if (cancelled) return;
        setCandidates(result.ok ? result.customers : []);
      },
      shouldSearch ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selectedCustomer]);

  // --- 空き状況(スタッフ・日付・時間・メニューが揃ったらデバウンスで確認) ---
  useEffect(() => {
    const ready =
      staffId !== "" && date !== "" && time !== "" && menuIds.length > 0;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        if (!ready) {
          setAvailability(null);
          return;
        }
        const result = await checkProxySlot({
          staffId,
          date,
          time,
          menuIds,
          // 変更モードは自分の旧予約を空き計算から除く(UPDATE方式の自己非衝突)
          excludeReservationId: isEdit ? reservationId : undefined,
        });
        if (cancelled) return;
        setAvailability(result);
      },
      ready ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [staffId, date, time, menuIds, isEdit, reservationId]);

  const selectCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer(customer);
    setQuery(customer.name);
    setCandidates([]);
    setFieldErrors((prev) => ({ ...prev, customer: undefined }));
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setQuery("");
    setNewPhone("");
    searchInputRef.current?.focus();
  };

  const searchInputRef = useRef<HTMLInputElement>(null);

  const toggleMenu = (id: string) => {
    setMenuIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
    setFieldErrors((prev) => ({ ...prev, menu: undefined }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    startSubmit(async () => {
      // 変更モード: 顧客は固定(送らない)。admin_update_reservation(UPDATE方式)へ
      const result =
        isEdit && reservationId !== undefined
          ? await updateAdminReservation({
              reservationId,
              menuIds,
              staffId,
              date,
              time,
              note,
            })
          : await createProxyReservation({
              customerId: selectedCustomer?.id ?? null,
              customerName: selectedCustomer !== null ? "" : query,
              customerPhone: selectedCustomer !== null ? "" : newPhone,
              menuIds,
              staffId,
              date,
              time,
              note,
            });
      if (result.ok) {
        // 登録・変更した日付のカレンダーへ(反映を確認できるように)。
        // push は別URL(search param)なのでサーバーコンポーネントが最新データを
        // 取り直す。router.refresh() と併用すると遷移がハングして送信状態が
        // 解除されないため、push 一本にする。
        router.push(`/admin?date=${date}`);
        return;
      }
      if (result.reason === "invalid_input") {
        setFieldErrors(result.errors);
        return;
      }
      if (result.reason === "past") {
        // サーバーの now で過去と判定された(クライアント時計は信用しない)
        setAvailability({
          status: "past",
          canRegister: false,
          message: result.message,
        });
        setFieldErrors((prev) => ({ ...prev, time: result.message }));
        setFormError(result.message);
        return;
      }
      if (result.reason === "closed") {
        // サーバーの business_hours で定休日と判定された(登録不可)
        setAvailability({
          status: "closed",
          canRegister: false,
          message: result.message,
        });
        setFieldErrors((prev) => ({ ...prev, date: result.message }));
        setFormError(result.message);
        return;
      }
      if (result.reason === "slot_taken") {
        setAvailability({
          status: "unavailable",
          canRegister: true,
          message: result.message,
        });
        setFormError(result.message);
        return;
      }
      setFormError(result.message);
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
      <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
        <h1 className="text-2xl font-bold">
          {isEdit ? "予約の変更" : "電話予約の代行登録"}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          {isEdit
            ? "メニュー・スタッフ・日時・メモを変更できます"
            : "オーナーが電話で受けた予約を登録します"}
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 flex flex-col gap-6"
          noValidate
        >
          {/* お客様(変更モードは固定表示。作成モードは既存顧客を検索) */}
          {isEdit ? (
            <div>
              <span className={labelClass}>お客様</span>
              <div
                className={cn(
                  inputClass,
                  "mt-2 flex items-center bg-muted text-muted-foreground",
                )}
              >
                {fixedCustomerName ?? ""}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                お客様は変更できません
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="proxy-customer" className={labelClass}>
                お客様名(既存顧客を検索)
              </label>
              <div className="relative mt-2">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  id="proxy-customer"
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  readOnly={selectedCustomer !== null}
                  autoComplete="off"
                  placeholder="お名前・電話番号で検索、または新規のお名前"
                  onChange={(event) => setQuery(event.target.value)}
                  className={cn(
                    inputClass,
                    "pl-11",
                    selectedCustomer !== null && "pr-11",
                  )}
                />
                {selectedCustomer !== null && (
                  <button
                    type="button"
                    onClick={clearCustomer}
                    aria-label="お客様の選択を解除"
                    className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X aria-hidden="true" className="size-5" />
                  </button>
                )}
              </div>

              {/* 候補リスト(選択で既存顧客に確定) */}
              {selectedCustomer === null && candidates.length > 0 && (
                <ul className="mt-2 overflow-hidden rounded-xl border border-border">
                  {candidates.map((customer) => (
                    <li key={customer.id}>
                      <button
                        type="button"
                        onClick={() => selectCustomer(customer)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted"
                      >
                        <span className="text-base font-bold">
                          {customer.name}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {customer.phone ?? "電話未登録"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* 新規客の電話(任意)。既存顧客を選んでいないときだけ出す */}
              {selectedCustomer === null && query.trim() !== "" && (
                <div className="mt-3">
                  <label
                    htmlFor="proxy-new-phone"
                    className="text-sm text-muted-foreground"
                  >
                    電話番号(任意・新規のお客様)
                  </label>
                  <input
                    id="proxy-new-phone"
                    type="tel"
                    value={newPhone}
                    autoComplete="off"
                    placeholder="090-1234-5678"
                    onChange={(event) => setNewPhone(event.target.value)}
                    className={cn(inputClass, "mt-1")}
                  />
                </div>
              )}
              {selectedCustomer !== null && (
                <p className="mt-2 text-sm text-muted-foreground">
                  既存のお客様として登録します
                </p>
              )}
              {fieldErrors.customer !== undefined && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {fieldErrors.customer}
                </p>
              )}
            </div>
          )}

          {/* メニュー(複数選択) */}
          <fieldset>
            <legend className={labelClass}>メニュー</legend>
            <div className="mt-2 flex flex-col gap-2">
              {menus.map((menu) => {
                const checked = menuIds.includes(menu.id);
                return (
                  <label
                    key={menu.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors",
                      checked
                        ? "border-primary bg-accent"
                        : "border-input bg-card hover:bg-muted",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMenu(menu.id)}
                        className="size-5 accent-primary"
                      />
                      <span className="text-base font-medium">{menu.name}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatYen(menu.price)} ・ {menu.durationMinutes}分
                    </span>
                  </label>
                );
              })}
            </div>
            {selectedMenus.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                合計 {summary.totalDurationMinutes}分 ・{" "}
                {formatYen(summary.totalPrice)}
              </p>
            )}
            {fieldErrors.menu !== undefined && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {fieldErrors.menu}
              </p>
            )}
          </fieldset>

          {/* スタッフ */}
          <div>
            <label htmlFor="proxy-staff" className={labelClass}>
              スタッフ
            </label>
            <select
              id="proxy-staff"
              value={staffId}
              onChange={(event) => {
                setStaffId(event.target.value);
                setFieldErrors((prev) => ({ ...prev, staff: undefined }));
              }}
              className={cn(inputClass, "mt-2")}
            >
              <option value="">選択してください</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            {fieldErrors.staff !== undefined && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {fieldErrors.staff}
              </p>
            )}
          </div>

          {/* 日付・時間 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="proxy-date" className={labelClass}>
                日付
              </label>
              <input
                id="proxy-date"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, date: undefined }));
                }}
                className={cn(inputClass, "mt-2")}
              />
              {fieldErrors.date !== undefined && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {fieldErrors.date}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="proxy-time" className={labelClass}>
                時間
              </label>
              <input
                id="proxy-time"
                type="time"
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, time: undefined }));
                }}
                className={cn(inputClass, "mt-2")}
              />
              {fieldErrors.time !== undefined && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {fieldErrors.time}
                </p>
              )}
            </div>
          </div>

          {/* 空き状況の表示(補助。最後の砦はEXCLUDE制約)。状態で色を出し分ける:
              available=空き(accent)/ past=過去で登録不可(destructive)/
              closed=定休日で登録不可(destructive)/
              unavailable=空き枠でないが上書き登録は可(注意色) */}
          {availability !== null && (
            <p
              className={cn(
                "rounded-xl px-4 py-3 text-base",
                availability.status === "available" &&
                  "bg-accent text-accent-foreground",
                (availability.status === "past" ||
                  availability.status === "closed") &&
                  "bg-destructive/10 text-destructive",
                availability.status === "unavailable" &&
                  "bg-muted text-muted-foreground",
              )}
            >
              {availability.message}
            </p>
          )}

          {/* メモ(任意・店内用) */}
          <div>
            <label htmlFor="proxy-note" className={labelClass}>
              メモ{" "}
              <span className="text-sm font-normal text-muted-foreground">
                (任意・店内用)
              </span>
            </label>
            <textarea
              id="proxy-note"
              value={note}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>

          {formError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={
              isSubmitting ||
              availability?.status === "past" ||
              availability?.status === "closed"
            }
            className="h-12 w-full rounded-xl text-base font-bold"
          >
            {isEdit
              ? isSubmitting
                ? "変更中…"
                : "この内容で変更"
              : isSubmitting
                ? "登録中…"
                : "この内容で登録"}
          </Button>
        </form>
      </div>
    </div>
  );
}
