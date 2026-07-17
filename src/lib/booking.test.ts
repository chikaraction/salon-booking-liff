import { describe, expect, it } from "vitest";

import {
  formatJstDateTimeLabel,
  formatYen,
  groupMenusByCategory,
  isSlotTakenError,
  isUuid,
  menuNamesLabel,
  parseChangeReservationResult,
  summarizeSelectedMenus,
  validateCustomerInfo,
} from "./booking";

describe("summarizeSelectedMenus: 選択メニューの合計", () => {
  it("合計金額・合計所要時間・件数を返す", () => {
    const result = summarizeSelectedMenus([
      { price: 4950, durationMinutes: 60 },
      { price: 6600, durationMinutes: 90 },
    ]);
    expect(result).toEqual({
      count: 2,
      totalPrice: 11550,
      totalDurationMinutes: 150,
    });
  });

  it("未選択なら0件・0円・0分", () => {
    expect(summarizeSelectedMenus([])).toEqual({
      count: 0,
      totalPrice: 0,
      totalDurationMinutes: 0,
    });
  });
});

describe("groupMenusByCategory: メニューのカテゴリ別グループ化", () => {
  const cut = { id: "cat-cut", name: "カット", description: "説明文" };
  const color = { id: "cat-color", name: "カラー", description: null };
  const menuA = {
    id: "m1",
    name: "カット",
    price: 4950,
    durationMinutes: 60,
    categoryId: "cat-cut",
  };
  const menuB = {
    id: "m2",
    name: "リタッチカラー",
    price: 6600,
    durationMinutes: 90,
    categoryId: "cat-color",
  };

  it("カテゴリ・メニューとも入力の並び(display_order順)を保つ", () => {
    const groups = groupMenusByCategory([cut, color], [menuA, menuB]);
    expect(groups.map((g) => g.name)).toEqual(["カット", "カラー"]);
    expect(groups[0].menus).toEqual([
      { id: "m1", name: "カット", price: 4950, durationMinutes: 60 },
    ]);
    expect(groups[1].description).toBeNull();
  });

  it("メニューが1件もないカテゴリは除外する", () => {
    const groups = groupMenusByCategory([cut, color], [menuA]);
    expect(groups.map((g) => g.id)).toEqual(["cat-cut"]);
  });
});

describe("validateCustomerInfo: 初回情報入力のバリデーション", () => {
  it("名前と電話番号が正しければokと正規化済みの値を返す", () => {
    const result = validateCustomerInfo({
      name: " 山田 花子 ",
      phone: "090-1234-5678",
    });
    expect(result).toEqual({
      ok: true,
      value: { name: "山田 花子", phone: "09012345678" },
    });
  });

  it("全角数字の電話番号は半角に正規化する", () => {
    const result = validateCustomerInfo({
      name: "山田",
      phone: "090−1234−5678",
    });
    expect(result).toEqual({
      ok: true,
      value: { name: "山田", phone: "09012345678" },
    });
  });

  it("名前が空ならエラー", () => {
    const result = validateCustomerInfo({ name: "  ", phone: "09012345678" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBe("お名前を入力してください");
  });

  it("電話番号が空ならエラー", () => {
    const result = validateCustomerInfo({ name: "山田", phone: "" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.phone).toBe("電話番号を入力してください");
  });

  it("電話番号の形式が不正ならエラー(0始まり10〜11桁以外)", () => {
    for (const phone of ["12345", "abc", "9012345678", "0901234567890"]) {
      const result = validateCustomerInfo({ name: "山田", phone });
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.errors.phone).toBe("電話番号の形式が正しくありません");
    }
  });

  it("固定電話(10桁)も受け付ける", () => {
    expect(
      validateCustomerInfo({ name: "山田", phone: "03-1234-5678" }).ok,
    ).toBe(true);
  });
});

describe("isSlotTakenError: EXCLUDE制約違反の判定", () => {
  it("SQLSTATE 23P01 のエラーを枠埋まりと判定する(ADR-004)", () => {
    expect(isSlotTakenError({ code: "23P01" })).toBe(true);
  });

  it("それ以外のエラーは枠埋まりではない", () => {
    expect(isSlotTakenError({ code: "P0001" })).toBe(false);
    expect(isSlotTakenError(null)).toBe(false);
    expect(isSlotTakenError(new Error("network"))).toBe(false);
  });
});

describe("isUuid: UUID形式の判定", () => {
  it("ハイフン区切りのUUID形式ならtrue(大文字も許容)", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("UUID形式でなければfalse", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("abc")).toBe(false);
    // ハイフンなし
    expect(isUuid("123e4567e89b12d3a456426614174000")).toBe(false);
    // 16進以外の文字を含む
    expect(isUuid("123e4567-e89b-12d3-a456-42661417400g")).toBe(false);
    // 前後に余計な文字がある
    expect(isUuid(" 123e4567-e89b-12d3-a456-426614174000")).toBe(false);
  });
});

describe("parseChangeReservationResult: 変更RPC(jsonb)の戻り値の解釈", () => {
  it("okなら新しい予約IDを取り出す", () => {
    expect(
      parseChangeReservationResult({
        result: "ok",
        reservation_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toEqual({
      result: "ok",
      reservationId: "123e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("not_found / deadline_passed はそのまま判別する", () => {
    expect(parseChangeReservationResult({ result: "not_found" })).toEqual({
      result: "not_found",
    });
    expect(parseChangeReservationResult({ result: "deadline_passed" })).toEqual(
      { result: "deadline_passed" },
    );
  });

  it("想定外の値はunexpectedにする(okなのに予約IDがない場合を含む)", () => {
    expect(parseChangeReservationResult(null)).toEqual({
      result: "unexpected",
    });
    expect(parseChangeReservationResult("ok")).toEqual({
      result: "unexpected",
    });
    expect(parseChangeReservationResult({ result: "ok" })).toEqual({
      result: "unexpected",
    });
    expect(
      parseChangeReservationResult({ result: "ok", reservation_id: 1 }),
    ).toEqual({ result: "unexpected" });
    expect(parseChangeReservationResult({ result: "cancelled" })).toEqual({
      result: "unexpected",
    });
  });
});

describe("表示フォーマット", () => {
  it("メニュー名を「カット + カラー」形式で連結する", () => {
    expect(menuNamesLabel(["カット", "カラー"])).toBe("カット + カラー");
    expect(menuNamesLabel(["カット"])).toBe("カット");
  });

  it("金額を「¥11,550」形式にする", () => {
    expect(formatYen(11550)).toBe("¥11,550");
    expect(formatYen(0)).toBe("¥0");
  });

  it("開始日時を「7月18日(土)11:00〜」形式(JST)にする", () => {
    expect(formatJstDateTimeLabel(new Date("2026-07-18T02:00:00Z"))).toBe(
      "7月18日(土)11:00〜",
    );
  });

  it("日付をまたぐUTC時刻でもJSTの暦日で表示する", () => {
    // UTC 7/17 23:30 = JST 7/18 08:30
    expect(formatJstDateTimeLabel(new Date("2026-07-17T23:30:00Z"))).toBe(
      "7月18日(土)8:30〜",
    );
  });
});
