import { describe, expect, it } from "vitest";

import {
  isPastStart,
  restoreSelectableMenuIds,
  sortMenusForProxyRegistration,
  validateProxyRegistration,
  validateReservationEdit,
  type ProxyRegistrationInput,
  type ReservationEditInput,
} from "./admin-reservation-form";
import { jstDateTime } from "./jst";

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

describe("isPastStart: 開始時刻が過去かどうか", () => {
  it("開始が現在より前なら true(1分前)", () => {
    expect(
      isPastStart(
        jstDateTime("2026-07-18", "11:00"),
        jstDateTime("2026-07-18", "11:01"),
      ),
    ).toBe(true);
  });

  it("開始ちょうど(start===now)は過去扱いしない(false)", () => {
    const at = jstDateTime("2026-07-18", "11:00");
    expect(isPastStart(at, at)).toBe(false);
  });

  it("開始が現在より後なら false(1分後)", () => {
    expect(
      isPastStart(
        jstDateTime("2026-07-18", "11:01"),
        jstDateTime("2026-07-18", "11:00"),
      ),
    ).toBe(false);
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

// ---------------------------------------------------------------------------
// 店側変更(モックDのフォームを変更モードで再利用)の入力検証。
// 顧客は固定(変更不可)なので顧客チェックはしない。それ以外は代行登録と同じ。
// ---------------------------------------------------------------------------

/** 全項目が妥当な変更入力(各テストで一部だけ壊す) */
const validEditInput: ReservationEditInput = {
  menuIds: ["menu-cut", "menu-color"],
  staffId: "staff-tanaka",
  date: "2026-07-18",
  time: "11:00",
};

describe("validateReservationEdit", () => {
  it("全項目が妥当なら ok と正規化済みの値を返す(顧客は検証しない)", () => {
    const result = validateReservationEdit(validEditInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      menuIds: ["menu-cut", "menu-color"],
      staffId: "staff-tanaka",
      date: "2026-07-18",
      time: "11:00",
    });
  });

  it("メニュー0件はエラー", () => {
    const result = validateReservationEdit({ ...validEditInput, menuIds: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.menu).toBeDefined();
  });

  it("メニューの重複は除去する(順序は保つ)", () => {
    const result = validateReservationEdit({
      ...validEditInput,
      menuIds: ["a", "b", "a"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.menuIds).toEqual(["a", "b"]);
  });

  it("スタッフ未指定はエラー", () => {
    const result = validateReservationEdit({ ...validEditInput, staffId: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.staff).toBeDefined();
  });

  it("日付が実在しない暦日ならエラー", () => {
    const result = validateReservationEdit({
      ...validEditInput,
      date: "2026-02-30",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.date).toBeDefined();
  });

  it("時間が HH:MM 形式でないならエラー", () => {
    const result = validateReservationEdit({ ...validEditInput, time: "9:0" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.time).toBeDefined();
  });

  it("複数項目の不備をまとめて返す", () => {
    const result = validateReservationEdit({
      menuIds: [],
      staffId: "",
      date: "bad",
      time: "bad",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.menu).toBeDefined();
    expect(result.errors.staff).toBeDefined();
    expect(result.errors.date).toBeDefined();
    expect(result.errors.time).toBeDefined();
  });
});

describe("restoreSelectableMenuIds", () => {
  it("保存済みメニューのうち現在も有効なものだけを復元する(保存順を保つ)", () => {
    expect(
      restoreSelectableMenuIds(["cut", "color", "perm"], ["perm", "cut"]),
    ).toEqual(["cut", "perm"]);
  });

  it("有効なものが1つもなければ空配列(未選択にフォールバック)", () => {
    expect(restoreSelectableMenuIds(["old"], ["cut", "color"])).toEqual([]);
  });

  it("重複を除去する", () => {
    expect(restoreSelectableMenuIds(["cut", "cut"], ["cut"])).toEqual(["cut"]);
  });

  it("保存済みが空なら空配列", () => {
    expect(restoreSelectableMenuIds([], ["cut"])).toEqual([]);
  });
});

describe("sortMenusForProxyRegistration", () => {
  // menus.display_order はカテゴリごとに0起点(saveMenuOrder の振り直し)
  const categories = [
    { id: "cat-color", displayOrder: 1 },
    { id: "cat-cut", displayOrder: 0 },
  ];

  it("カテゴリ順が優先される(後のカテゴリの0番は、先のカテゴリの1番より後ろ)", () => {
    const menus = [
      { id: "color-0", categoryId: "cat-color", displayOrder: 0 },
      { id: "cut-1", categoryId: "cat-cut", displayOrder: 1 },
      { id: "cut-0", categoryId: "cat-cut", displayOrder: 0 },
    ];
    expect(
      sortMenusForProxyRegistration(categories, menus).map((m) => m.id),
    ).toEqual(["cut-0", "cut-1", "color-0"]);
  });

  it("カテゴリ内はメニューの display_order 順", () => {
    const menus = [
      { id: "cut-2", categoryId: "cat-cut", displayOrder: 2 },
      { id: "cut-0", categoryId: "cat-cut", displayOrder: 0 },
      { id: "cut-1", categoryId: "cat-cut", displayOrder: 1 },
    ];
    expect(
      sortMenusForProxyRegistration(categories, menus).map((m) => m.id),
    ).toEqual(["cut-0", "cut-1", "cut-2"]);
  });

  it("カテゴリ順もメニュー順も同じ値なら id 順で決まる(入力の順序に依存しない)", () => {
    const sameOrderCategories = [
      { id: "cat-a", displayOrder: 0 },
      { id: "cat-b", displayOrder: 0 },
    ];
    const menus = [
      { id: "menu-c", categoryId: "cat-a", displayOrder: 0 },
      { id: "menu-a", categoryId: "cat-b", displayOrder: 0 },
      { id: "menu-b", categoryId: "cat-a", displayOrder: 0 },
    ];
    const expected = ["menu-a", "menu-b", "menu-c"];
    expect(
      sortMenusForProxyRegistration(sameOrderCategories, menus).map(
        (m) => m.id,
      ),
    ).toEqual(expected);
    expect(
      sortMenusForProxyRegistration(
        sameOrderCategories,
        [...menus].reverse(),
      ).map((m) => m.id),
    ).toEqual(expected);
  });

  it("入力の配列を破壊しない", () => {
    const menus = [
      { id: "color-0", categoryId: "cat-color", displayOrder: 0 },
      { id: "cut-0", categoryId: "cat-cut", displayOrder: 0 },
    ];
    const before = structuredClone(menus);
    sortMenusForProxyRegistration(categories, menus);
    expect(menus).toEqual(before);
  });

  it("メニューの他のフィールドはそのまま返す", () => {
    const menus = [
      {
        id: "cut-0",
        categoryId: "cat-cut",
        displayOrder: 0,
        name: "カット",
        price: 4000,
      },
    ];
    expect(sortMenusForProxyRegistration(categories, menus)).toEqual(menus);
  });

  it("カテゴリ一覧に無いカテゴリのメニューは、既知のカテゴリより後ろに置く", () => {
    const menus = [
      { id: "orphan-0", categoryId: "cat-unknown", displayOrder: 0 },
      { id: "color-5", categoryId: "cat-color", displayOrder: 5 },
    ];
    expect(
      sortMenusForProxyRegistration(categories, menus).map((m) => m.id),
    ).toEqual(["color-5", "orphan-0"]);
  });
});
