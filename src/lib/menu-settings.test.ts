import { describe, expect, it } from "vitest";

import {
  CATEGORY_INVALID_MESSAGE,
  MENU_HIDE_INSTEAD_OF_DELETE_LINES,
  MENU_INVALID_MESSAGE,
  buildMenuAdminGroups,
  categoryDeleteBlockedMessage,
  countMenusByCategory,
  diffMenuCategories,
  findCategoryDeleteViolation,
  formatMenuDuration,
  formatMenuPrice,
  renumberDisplayOrder,
  toCategoryDrafts,
  validateCategoryDrafts,
  validateMenuInput,
  type CategoryDraft,
  type MenuCategoryRecord,
  type MenuInput,
  type MenuRecord,
} from "./menu-settings";

// テスト用の値。店舗固有の値をコードに書かない(ADR-007)ため、
// 名前・料金・所要時間はテストの中だけで組み立てる架空の値にする。

function category(patch: Partial<MenuCategoryRecord> = {}): MenuCategoryRecord {
  return {
    id: "cat-1",
    name: "カテゴリ1",
    description: null,
    displayOrder: 0,
    ...patch,
  };
}

function menu(patch: Partial<MenuRecord> = {}): MenuRecord {
  return {
    id: "menu-1",
    name: "メニュー1",
    categoryId: "cat-1",
    price: 1000,
    durationMinutes: 30,
    displayOrder: 0,
    isActive: true,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// 1. 表示の整形(モックFの「料金(税込)」「所要時間」列)
// ---------------------------------------------------------------------------

describe("formatMenuPrice", () => {
  it("3桁ごとの区切りを入れた「¥4,620」形式にする", () => {
    expect(formatMenuPrice(4620)).toBe("¥4,620");
    expect(formatMenuPrice(11000)).toBe("¥11,000");
  });

  it("1000未満は区切りを入れない", () => {
    expect(formatMenuPrice(0)).toBe("¥0");
    expect(formatMenuPrice(990)).toBe("¥990");
  });
});

describe("formatMenuDuration", () => {
  it("「60分」形式にする", () => {
    expect(formatMenuDuration(60)).toBe("60分");
    expect(formatMenuDuration(15)).toBe("15分");
  });
});

// ---------------------------------------------------------------------------
// 2. カテゴリごとのグルーピング(モックFの淡色の区切り行 + その下のメニュー)
// ---------------------------------------------------------------------------

describe("buildMenuAdminGroups", () => {
  it("カテゴリを表示順に並べ、その下に所属メニューを表示順で並べる", () => {
    const groups = buildMenuAdminGroups(
      [
        category({ id: "cat-2", name: "カテゴリ2", displayOrder: 1 }),
        category({ id: "cat-1", name: "カテゴリ1", displayOrder: 0 }),
      ],
      [
        menu({ id: "m-2", categoryId: "cat-1", displayOrder: 1 }),
        menu({ id: "m-3", categoryId: "cat-2", displayOrder: 0 }),
        menu({ id: "m-1", categoryId: "cat-1", displayOrder: 0 }),
      ],
    );

    expect(groups.map((group) => group.id)).toEqual(["cat-1", "cat-2"]);
    expect(groups[0]?.menus.map((row) => row.id)).toEqual(["m-1", "m-2"]);
    expect(groups[1]?.menus.map((row) => row.id)).toEqual(["m-3"]);
  });

  it("メニューが1件も無いカテゴリも見出しごと残す(管理画面では消さない)", () => {
    const groups = buildMenuAdminGroups(
      [category({ id: "cat-1" }), category({ id: "cat-2", displayOrder: 1 })],
      [menu({ categoryId: "cat-1" })],
    );

    expect(groups).toHaveLength(2);
    expect(groups[1]?.menus).toEqual([]);
  });

  it("非表示(is_active = false)のメニューも一覧に含める", () => {
    const groups = buildMenuAdminGroups(
      [category({ id: "cat-1" })],
      [menu({ id: "m-1", isActive: false })],
    );

    expect(groups[0]?.menus.map((row) => row.id)).toEqual(["m-1"]);
  });

  it("表示順が同じメニューは名前順にして並びが揺れないようにする", () => {
    const groups = buildMenuAdminGroups(
      [category({ id: "cat-1" })],
      [
        menu({ id: "m-2", name: "い", displayOrder: 0 }),
        menu({ id: "m-1", name: "あ", displayOrder: 0 }),
      ],
    );

    expect(groups[0]?.menus.map((row) => row.id)).toEqual(["m-1", "m-2"]);
  });

  it("どのカテゴリにも属さないメニューは出さない(カテゴリが消えた直後など)", () => {
    const groups = buildMenuAdminGroups(
      [category({ id: "cat-1" })],
      [
        menu({ id: "m-1", categoryId: "cat-1" }),
        menu({ id: "m-9", categoryId: "cat-x" }),
      ],
    );

    expect(groups[0]?.menus.map((row) => row.id)).toEqual(["m-1"]);
  });
});

// ---------------------------------------------------------------------------
// 3. 並べ替え結果の再採番(display_order)
// ---------------------------------------------------------------------------

describe("renumberDisplayOrder", () => {
  it("並べ替え後の位置を display_order にする", () => {
    const changes = renumberDisplayOrder(
      ["b", "c", "a"],
      [
        { id: "a", displayOrder: 0 },
        { id: "b", displayOrder: 1 },
        { id: "c", displayOrder: 2 },
      ],
    );

    expect(changes).toEqual([
      { id: "b", displayOrder: 0 },
      { id: "c", displayOrder: 1 },
      { id: "a", displayOrder: 2 },
    ]);
  });

  it("変更が必要な行だけを返す(位置が変わらない行はUPDATEしない)", () => {
    const changes = renumberDisplayOrder(
      ["a", "c", "b"],
      [
        { id: "a", displayOrder: 0 },
        { id: "b", displayOrder: 1 },
        { id: "c", displayOrder: 2 },
      ],
    );

    expect(changes).toEqual([
      { id: "c", displayOrder: 1 },
      { id: "b", displayOrder: 2 },
    ]);
  });

  it("並びが変わっていなければ空を返す", () => {
    const changes = renumberDisplayOrder(
      ["a", "b"],
      [
        { id: "a", displayOrder: 0 },
        { id: "b", displayOrder: 1 },
      ],
    );

    expect(changes).toEqual([]);
  });

  it("飛び番・重複していた display_order を0からの連番に直す", () => {
    const changes = renumberDisplayOrder(
      ["a", "b"],
      [
        { id: "a", displayOrder: 5 },
        { id: "b", displayOrder: 5 },
      ],
    );

    expect(changes).toEqual([
      { id: "a", displayOrder: 0 },
      { id: "b", displayOrder: 1 },
    ]);
  });

  it("対象に含まれないIDは無視する(並べ替えはカテゴリ内に限定するため)", () => {
    const changes = renumberDisplayOrder(
      ["b", "よそのカテゴリのID", "a"],
      [
        { id: "a", displayOrder: 0 },
        { id: "b", displayOrder: 1 },
      ],
    );

    // よそのIDは並びから抜け、残った2件だけが0起点で採番し直される
    expect(changes).toEqual([
      { id: "b", displayOrder: 0 },
      { id: "a", displayOrder: 1 },
    ]);
  });

  it("並べ替え結果に現れなかった行は末尾へ回す(取りこぼしても行が消えない)", () => {
    const changes = renumberDisplayOrder(
      ["c"],
      [
        { id: "a", displayOrder: 0 },
        { id: "b", displayOrder: 1 },
        { id: "c", displayOrder: 2 },
      ],
    );

    expect(changes).toEqual([
      { id: "c", displayOrder: 0 },
      { id: "a", displayOrder: 1 },
      { id: "b", displayOrder: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. メニューのバリデーション(DB制約と同じルール)
// ---------------------------------------------------------------------------

function menuInput(patch: Partial<MenuInput> = {}): MenuInput {
  return {
    name: "メニュー1",
    categoryId: "cat-1",
    price: "1000",
    durationMinutes: "30",
    isActive: true,
    ...patch,
  };
}

describe("validateMenuInput", () => {
  it("正しい入力は数値に変換した値を返す", () => {
    const result = validateMenuInput(menuInput({ name: " メニュー1 " }));

    expect(result).toEqual({
      ok: true,
      value: {
        name: "メニュー1",
        categoryId: "cat-1",
        price: 1000,
        durationMinutes: 30,
        isActive: true,
      },
    });
  });

  it("名前が空(空白だけを含む)ならエラーにする", () => {
    const result = validateMenuInput(menuInput({ name: "  " }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBeDefined();
    expect(result.message).toBe(MENU_INVALID_MESSAGE);
  });

  it("カテゴリ未選択はエラーにする(menus.category_id は NOT NULL)", () => {
    const result = validateMenuInput(menuInput({ categoryId: "" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.categoryId).toBeDefined();
  });

  it("料金は0以上の整数(menus_price_check と同じ)", () => {
    expect(validateMenuInput(menuInput({ price: "0" })).ok).toBe(true);
    expect(validateMenuInput(menuInput({ price: "-1" })).ok).toBe(false);
    expect(validateMenuInput(menuInput({ price: "1000.5" })).ok).toBe(false);
    expect(validateMenuInput(menuInput({ price: "" })).ok).toBe(false);
    expect(validateMenuInput(menuInput({ price: "無料" })).ok).toBe(false);
  });

  it("所要時間は正の整数(menus_duration_minutes_check と同じ)", () => {
    expect(validateMenuInput(menuInput({ durationMinutes: "1" })).ok).toBe(
      true,
    );
    expect(validateMenuInput(menuInput({ durationMinutes: "0" })).ok).toBe(
      false,
    );
    expect(validateMenuInput(menuInput({ durationMinutes: "-30" })).ok).toBe(
      false,
    );
    expect(validateMenuInput(menuInput({ durationMinutes: "30.5" })).ok).toBe(
      false,
    );
    expect(validateMenuInput(menuInput({ durationMinutes: "" })).ok).toBe(
      false,
    );
  });

  it("非表示(is_active = false)はそのまま通す(非表示が削除の代わりのため)", () => {
    const result = validateMenuInput(menuInput({ isActive: false }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. カテゴリ編集ダイアログ(モックF詳細): 入力・差分・削除可否
// ---------------------------------------------------------------------------

describe("toCategoryDrafts", () => {
  it("表示順に並べ、各行に安定したキーを振る", () => {
    const drafts = toCategoryDrafts([
      category({ id: "cat-2", name: "2", displayOrder: 1 }),
      category({ id: "cat-1", name: "1", displayOrder: 0 }),
    ]);

    expect(drafts.map((draft) => draft.id)).toEqual(["cat-1", "cat-2"]);
    expect(drafts.map((draft) => draft.key)).toEqual(["cat-1", "cat-2"]);
    expect(drafts.map((draft) => draft.name)).toEqual(["1", "2"]);
  });
});

function draft(patch: Partial<CategoryDraft> = {}): CategoryDraft {
  return { key: "k-1", id: "cat-1", name: "カテゴリ1", ...patch };
}

describe("validateCategoryDrafts", () => {
  it("名前が空の行はエラーにする(行のキーで場所が分かる)", () => {
    const result = validateCategoryDrafts([
      draft({ key: "k-1" }),
      draft({ key: "k-2", id: null, name: "   " }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors["k-2"]).toBeDefined();
    expect(result.errors["k-1"]).toBeUndefined();
    expect(result.message).toBe(CATEGORY_INVALID_MESSAGE);
  });

  it("正しい入力は前後の空白を落とした値を返す", () => {
    const result = validateCategoryDrafts([draft({ name: " カテゴリ1 " })]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { key: "k-1", id: "cat-1", name: "カテゴリ1" },
    ]);
  });
});

describe("diffMenuCategories", () => {
  const current = [
    category({ id: "cat-1", name: "1", displayOrder: 0 }),
    category({ id: "cat-2", name: "2", displayOrder: 1 }),
    category({ id: "cat-3", name: "3", displayOrder: 2 }),
  ];

  it("並びの位置をそのまま display_order にする", () => {
    const diff = diffMenuCategories({
      current,
      drafts: [
        draft({ key: "cat-3", id: "cat-3", name: "3" }),
        draft({ key: "cat-1", id: "cat-1", name: "1" }),
        draft({ key: "cat-2", id: "cat-2", name: "2" }),
      ],
    });

    expect(diff.updates).toEqual([
      { id: "cat-3", name: "3", displayOrder: 0 },
      { id: "cat-1", name: "1", displayOrder: 1 },
      { id: "cat-2", name: "2", displayOrder: 2 },
    ]);
  });

  it("名前も並びも変わらない行はUPDATEしない", () => {
    const diff = diffMenuCategories({
      current,
      drafts: [
        draft({ key: "cat-1", id: "cat-1", name: "1" }),
        draft({ key: "cat-2", id: "cat-2", name: "2改" }),
        draft({ key: "cat-3", id: "cat-3", name: "3" }),
      ],
    });

    expect(diff.updates).toEqual([
      { id: "cat-2", name: "2改", displayOrder: 1 },
    ]);
    expect(diff.inserts).toEqual([]);
    expect(diff.deleteIds).toEqual([]);
  });

  it("IDの無い行は追加、消えた行は削除にする", () => {
    const diff = diffMenuCategories({
      current,
      drafts: [
        draft({ key: "cat-1", id: "cat-1", name: "1" }),
        draft({ key: "new-1", id: null, name: "新" }),
      ],
    });

    expect(diff.inserts).toEqual([{ name: "新", displayOrder: 1 }]);
    expect(diff.deleteIds).toEqual(["cat-2", "cat-3"]);
  });

  it("現在存在しないIDの行は無視する(他の画面で消された後の保存)", () => {
    const diff = diffMenuCategories({
      current,
      drafts: [
        draft({ key: "cat-1", id: "cat-1", name: "1" }),
        draft({ key: "cat-9", id: "cat-9", name: "9" }),
      ],
    });

    expect(diff.updates).toEqual([]);
    expect(diff.inserts).toEqual([]);
    expect(diff.deleteIds).toEqual(["cat-2", "cat-3"]);
  });
});

describe("countMenusByCategory", () => {
  it("非表示のメニューも数える(参照が残っている限り削除できないため)", () => {
    const counts = countMenusByCategory([
      menu({ id: "m-1", categoryId: "cat-1" }),
      menu({ id: "m-2", categoryId: "cat-1", isActive: false }),
      menu({ id: "m-3", categoryId: "cat-2" }),
    ]);

    expect(counts["cat-1"]).toBe(2);
    expect(counts["cat-2"]).toBe(1);
    expect(counts["cat-3"]).toBeUndefined();
  });
});

describe("findCategoryDeleteViolation", () => {
  const categories = [
    category({ id: "cat-1", name: "カテゴリ1" }),
    category({ id: "cat-2", name: "カテゴリ2" }),
  ];

  it("所属メニューが1件でもあるカテゴリの削除を拒否し、理由を返す", () => {
    const message = findCategoryDeleteViolation({
      deleteIds: ["cat-1"],
      categories,
      menuCounts: countMenusByCategory([menu({ categoryId: "cat-1" })]),
    });

    expect(message).toBe(
      categoryDeleteBlockedMessage({ name: "カテゴリ1", menuCount: 1 }),
    );
    expect(message).toContain("カテゴリ1");
    expect(message).toContain("1件");
  });

  it("非表示のメニューしか無くても削除できない(category_id は NOT NULL)", () => {
    const message = findCategoryDeleteViolation({
      deleteIds: ["cat-1"],
      categories,
      menuCounts: countMenusByCategory([
        menu({ categoryId: "cat-1", isActive: false }),
      ]),
    });

    expect(message).not.toBeNull();
  });

  it("所属メニューが無ければ削除できる", () => {
    const message = findCategoryDeleteViolation({
      deleteIds: ["cat-2"],
      categories,
      menuCounts: countMenusByCategory([menu({ categoryId: "cat-1" })]),
    });

    expect(message).toBeNull();
  });

  it("削除対象が無ければ何も言わない", () => {
    const message = findCategoryDeleteViolation({
      deleteIds: [],
      categories,
      menuCounts: countMenusByCategory([menu({ categoryId: "cat-1" })]),
    });

    expect(message).toBeNull();
  });
});

describe("MENU_HIDE_INSTEAD_OF_DELETE_LINES", () => {
  it("各行が「。」で終わる(改行位置が文の終わりに一致している)", () => {
    for (const line of MENU_HIDE_INSTEAD_OF_DELETE_LINES) {
      expect(line.endsWith("。")).toBe(true);
    }
  });

  it("連結すると変更前の本文と一字一句同じ(文言を変えていない)", () => {
    expect(MENU_HIDE_INSTEAD_OF_DELETE_LINES.join("")).toBe(
      "メニューの削除はできません。過去の予約が参照しているため、使わなくなったメニューは「表示する」をオフにしてください。オフにするとお客様の予約画面に出なくなり、過去の予約はそのまま残ります。",
    );
  });
});
