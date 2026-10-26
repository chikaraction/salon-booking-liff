// 予約確定フローの判断ロジック(純粋関数)。
// メニュー合計・顧客情報バリデーション・表示フォーマットを扱う。
// 枠埋まりなどDBエラーの判定は db-errors.ts にある。
// JSTの壁時計への変換は jst.ts に任せる(JST = UTC+9 固定)。

import { jstParts, WEEKDAY_LABELS } from "./jst";

export type SelectedMenu = {
  price: number;
  durationMinutes: number;
};

export type MenuSummary = {
  count: number;
  totalPrice: number;
  totalDurationMinutes: number;
};

export type CustomerInfoInput = {
  name: string;
  phone: string;
};

export type CustomerInfoErrors = {
  name?: string;
  phone?: string;
};

export type CustomerInfoResult =
  | { ok: true; value: { name: string; phone: string } }
  | { ok: false; errors: CustomerInfoErrors };

/** 選択メニューの件数・合計金額・合計所要時間をまとめる */
export function summarizeSelectedMenus(menus: SelectedMenu[]): MenuSummary {
  return {
    count: menus.length,
    totalPrice: menus.reduce((sum, m) => sum + m.price, 0),
    totalDurationMinutes: menus.reduce((sum, m) => sum + m.durationMinutes, 0),
  };
}

export type MenuCategoryInput = {
  id: string;
  name: string;
  description: string | null;
};

export type CategorizedMenu = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  categoryId: string;
};

export type MenuCategoryGroup = MenuCategoryInput & {
  menus: Array<Omit<CategorizedMenu, "categoryId">>;
};

/**
 * メニューをカテゴリごとにグループ化する(客側メニュー選択画面用)。
 * カテゴリ・メニューとも入力の並び(display_order順)を保ち、
 * 表示できるメニューが1件もないカテゴリは見出しごと出さないため除外する。
 */
export function groupMenusByCategory(
  categories: MenuCategoryInput[],
  menus: CategorizedMenu[],
): MenuCategoryGroup[] {
  return categories
    .map((category) => ({
      ...category,
      menus: menus
        .filter((menu) => menu.categoryId === category.id)
        .map((menu) => ({
          id: menu.id,
          name: menu.name,
          price: menu.price,
          durationMinutes: menu.durationMinutes,
        })),
    }))
    .filter((group) => group.menus.length > 0);
}

/** 全角数字を半角に変換する */
function toHalfWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 電話番号の表記ゆれを正規化する。
 * 全角数字は半角へ、ハイフン類(-・‐〜―・−・ー)・空白・括弧は除去する。
 */
function normalizePhone(phone: string): string {
  return toHalfWidthDigits(phone).replace(/[\s\-‐-―−ー－()（）]/g, "");
}

/**
 * 初回情報入力(お名前・電話番号)のバリデーション。
 * okなら正規化済みの値を返す。電話番号は0始まりの10〜11桁(固定電話・携帯)を受け付ける。
 */
export function validateCustomerInfo(
  input: CustomerInfoInput,
): CustomerInfoResult {
  const errors: CustomerInfoErrors = {};

  const name = input.name.trim();
  if (name === "") {
    errors.name = "お名前を入力してください";
  }

  const phone = normalizePhone(input.phone);
  if (phone === "") {
    errors.phone = "電話番号を入力してください";
  } else if (!/^0\d{9,10}$/.test(phone)) {
    errors.phone = "電話番号の形式が正しくありません";
  }

  if (errors.name !== undefined || errors.phone !== undefined) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, phone } };
}

/**
 * UUID形式(ハイフン区切りの8-4-4-4-12の16進、大文字小文字は問わない)か判定する。
 * URL由来の予約IDをDBに問い合わせる前の形式チェックに使う
 * (不正な形式をuuid列と比較するとPostgRESTがエラーを返すため)。
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export type ChangeReservationOutcome =
  | { result: "ok"; reservationId: string }
  | { result: "not_found" }
  | { result: "deadline_passed" }
  | { result: "unexpected" };

/**
 * 変更RPC(change_reservation)のjsonb戻り値を判別可能な型に解釈する。
 * 想定形: {"result":"ok","reservation_id":"<新ID>"} / {"result":"not_found"} /
 * {"result":"deadline_passed"}。それ以外(okなのにIDがない等)は unexpected。
 */
export function parseChangeReservationResult(
  data: unknown,
): ChangeReservationOutcome {
  if (typeof data !== "object" || data === null || !("result" in data)) {
    return { result: "unexpected" };
  }
  const result = (data as { result: unknown }).result;
  if (result === "ok") {
    const reservationId = (data as { reservation_id?: unknown }).reservation_id;
    if (typeof reservationId === "string" && reservationId !== "") {
      return { result: "ok", reservationId };
    }
    return { result: "unexpected" };
  }
  if (result === "not_found") {
    return { result: "not_found" };
  }
  if (result === "deadline_passed") {
    return { result: "deadline_passed" };
  }
  return { result: "unexpected" };
}

/** メニュー名を「カット + カラー」形式で連結する(チップ・完了画面用) */
export function menuNamesLabel(names: string[]): string {
  return names.join(" + ");
}

/** 金額を「¥11,550」形式(半角¥ + 3桁区切り)にする */
export function formatYen(price: number): string {
  return `¥${String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** 開始日時(UTC)を「7月18日(土)11:00〜」形式(JSTの暦日・壁時計時刻)にする */
export function formatJstDateTimeLabel(start: Date): string {
  const { month, day, weekday, hours, minutes } = jstParts(start);
  return `${month}月${day}日(${WEEKDAY_LABELS[weekday]})${hours}:${String(minutes).padStart(2, "0")}〜`;
}
