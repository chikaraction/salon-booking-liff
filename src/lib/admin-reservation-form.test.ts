import { describe, expect, it } from "vitest";

import {
  isWallClockTime,
  validateProxyRegistration,
  type ProxyRegistrationInput,
} from "./admin-reservation-form";

// ---------------------------------------------------------------------------
// 代行登録フォームの入力検証(モックD準拠)。
// UIが各項目にエラーを出せるよう { ok:false, errors } を返す。
// ---------------------------------------------------------------------------

/** 全項目が妥当な入力(各テストで一部だけ壊す) */
const validInput: ProxyRegistrationInput = {
  customerId: null,
  customerName: "山田 花子",
  customerPhone: "090-1234-5678",
  menuIds: ["menu-cut", "menu-color"],
  staffId: "staff-tanaka",
  date: "2026-07-18",
  time: "11:00",
};

describe("isWallClockTime", () => {
  it("HH:MM 形式(00:00〜23:59)を受け付ける", () => {
    expect(isWallClockTime("00:00")).toBe(true);
    expect(isWallClockTime("09:30")).toBe(true);
    expect(isWallClockTime("23:59")).toBe(true);
  });

  it("範囲外・桁数違い・秒付きは拒否する", () => {
    expect(isWallClockTime("24:00")).toBe(false);
    expect(isWallClockTime("9:00")).toBe(false);
    expect(isWallClockTime("11:60")).toBe(false);
    expect(isWallClockTime("11:00:00")).toBe(false);
    expect(isWallClockTime("")).toBe(false);
  });
});

describe("validateProxyRegistration", () => {
  it("全項目が妥当なら ok と正規化済みの値を返す", () => {
    const result = validateProxyRegistration(validInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      customerId: null,
      customerName: "山田 花子",
      customerPhone: "090-1234-5678",
      menuIds: ["menu-cut", "menu-color"],
      staffId: "staff-tanaka",
      date: "2026-07-18",
      time: "11:00",
    });
  });

  describe("お客様", () => {
    it("既存顧客ID があれば新規名なしでも通り、名前・電話は捨てる", () => {
      const result = validateProxyRegistration({
        ...validInput,
        customerId: "cust-1",
        customerName: "",
        customerPhone: "",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.customerId).toBe("cust-1");
      expect(result.value.customerName).toBeNull();
      expect(result.value.customerPhone).toBeNull();
    });

    it("既存顧客IDがなく新規名も空ならエラー", () => {
      const result = validateProxyRegistration({
        ...validInput,
        customerId: null,
        customerName: "   ",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.customer).toBeDefined();
    });

    it("新規名は前後の空白を除去する", () => {
      const result = validateProxyRegistration({
        ...validInput,
        customerName: "  田中  ",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.customerName).toBe("田中");
    });

    it("新規客の電話は任意(空なら null)", () => {
      const result = validateProxyRegistration({
        ...validInput,
        customerPhone: "  ",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.customerPhone).toBeNull();
    });
  });

  describe("メニュー", () => {
    it("0件ならエラー", () => {
      const result = validateProxyRegistration({ ...validInput, menuIds: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.menu).toBeDefined();
    });

    it("重複は除去する(順序は保つ)", () => {
      const result = validateProxyRegistration({
        ...validInput,
        menuIds: ["a", "b", "a"],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.menuIds).toEqual(["a", "b"]);
    });
  });

  describe("スタッフ・日付・時間", () => {
    it("スタッフ未指定はエラー", () => {
      const result = validateProxyRegistration({ ...validInput, staffId: "" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.staff).toBeDefined();
    });

    it("日付が実在しない暦日ならエラー", () => {
      const result = validateProxyRegistration({
        ...validInput,
        date: "2026-02-30",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.date).toBeDefined();
    });

    it("時間が HH:MM 形式でないならエラー", () => {
      const result = validateProxyRegistration({ ...validInput, time: "9:0" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.time).toBeDefined();
    });
  });

  it("複数項目の不備をまとめて返す", () => {
    const result = validateProxyRegistration({
      customerId: null,
      customerName: "",
      customerPhone: "",
      menuIds: [],
      staffId: "",
      date: "not-a-date",
      time: "bad",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.customer).toBeDefined();
    expect(result.errors.menu).toBeDefined();
    expect(result.errors.staff).toBeDefined();
    expect(result.errors.date).toBeDefined();
    expect(result.errors.time).toBeDefined();
  });
});
