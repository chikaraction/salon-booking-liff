import { describe, expect, it } from "vitest";

import {
  SETTINGS_PERMISSION_DENIED_MESSAGE,
  canManageSettings,
  isStaffRole,
  visibleAdminNavItems,
  type AdminNavItem,
} from "./admin-permissions";

describe("canManageSettings(設定系を変更できるか)", () => {
  it("オーナーは設定系を変更できる", () => {
    expect(canManageSettings("owner")).toBe(true);
  });

  it("スタッフは設定系を変更できない", () => {
    expect(canManageSettings("staff")).toBe(false);
  });

  it("未ログイン・staff.auth_user_id 未紐付け(null)は変更できない", () => {
    // current_staff_role() が NULL を返すケース。
    // 紐付け漏れで「オーナーのつもりが変更できない」が起きうるので必ず false
    expect(canManageSettings(null)).toBe(false);
  });
});

describe("isStaffRole(DBのrole文字列の型ガード)", () => {
  it("owner / staff だけを受け付ける", () => {
    expect(isStaffRole("owner")).toBe(true);
    expect(isStaffRole("staff")).toBe(true);
  });

  it("想定外の値・null・非文字列は受け付けない", () => {
    expect(isStaffRole("admin")).toBe(false);
    expect(isStaffRole("")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
    expect(isStaffRole(1)).toBe(false);
  });
});

describe("SETTINGS_PERMISSION_DENIED_MESSAGE(権限不足のメッセージ)", () => {
  it("オーナー権限が必要だと日本語で伝える", () => {
    expect(SETTINGS_PERMISSION_DENIED_MESSAGE).toContain("オーナー権限");
  });

  it("特定のロール名を断定しない(未紐付けのユーザーにも当てはまる文言)", () => {
    // role が NULL(未紐付け)のときも同じ文言を出すため、
    // 「あなたはスタッフです」のような断定は含めない
    expect(SETTINGS_PERMISSION_DENIED_MESSAGE).not.toContain("スタッフ");
  });
});

describe("visibleAdminNavItems(サイドバーのナビ項目の絞り込み)", () => {
  const items: AdminNavItem[] = [
    {
      href: "/admin",
      label: "予約カレンダー",
      ownerOnly: false,
      implemented: true,
    },
    {
      href: "/admin/reservations/new",
      label: "代行登録",
      ownerOnly: false,
      implemented: true,
    },
    {
      href: "/admin/settings/business",
      label: "営業日・営業時間",
      ownerOnly: true,
      implemented: true,
    },
    {
      href: "/admin/settings/menus",
      label: "メニュー",
      ownerOnly: true,
      implemented: false,
    },
  ];

  it("オーナーにはオーナー専用の項目も表示する", () => {
    expect(
      visibleAdminNavItems(items, "owner").map((item) => item.href),
    ).toEqual([
      "/admin",
      "/admin/reservations/new",
      "/admin/settings/business",
    ]);
  });

  it("スタッフにはオーナー専用の項目を表示しない", () => {
    expect(
      visibleAdminNavItems(items, "staff").map((item) => item.href),
    ).toEqual(["/admin", "/admin/reservations/new"]);
  });

  it("ロールが不明(未紐付け)のときもオーナー専用の項目を表示しない", () => {
    expect(visibleAdminNavItems(items, null).map((item) => item.href)).toEqual([
      "/admin",
      "/admin/reservations/new",
    ]);
  });

  it("未実装の画面はオーナーにも表示しない(404を踏ませないため)", () => {
    expect(visibleAdminNavItems(items, "owner")).not.toContainEqual(
      expect.objectContaining({ href: "/admin/settings/menus" }),
    );
  });

  it("元の配列を書き換えない", () => {
    const before = [...items];
    visibleAdminNavItems(items, "staff");
    expect(items).toEqual(before);
  });

  it("アイコンなど追加のプロパティを持つ項目でもそのまま返す(型を保つ)", () => {
    const withIcon = [
      {
        href: "/admin",
        label: "予約カレンダー",
        ownerOnly: false,
        implemented: true,
        icon: "calendar",
      },
    ];
    expect(visibleAdminNavItems(withIcon, "staff")[0].icon).toBe("calendar");
  });
});
