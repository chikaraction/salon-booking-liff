import { describe, expect, it } from "vitest";
import { isAdminNavActive } from "./admin-nav";

describe("isAdminNavActive(サイドバーのアクティブ判定)", () => {
  it("/admin は完全一致のときだけアクティブ", () => {
    expect(isAdminNavActive("/admin", "/admin")).toBe(true);
    expect(isAdminNavActive("/admin/reservations/new", "/admin")).toBe(false);
  });

  it("代行登録は完全一致のみアクティブ(配下の変更画面では光らせない)", () => {
    expect(
      isAdminNavActive("/admin/reservations/new", "/admin/reservations/new"),
    ).toBe(true);
    // 変更画面(/admin/reservations/[id]/edit)も代行登録系としてはアクティブにしない
    expect(
      isAdminNavActive(
        "/admin/reservations/abc/edit",
        "/admin/reservations/new",
      ),
    ).toBe(false);
  });

  it("無関係のパスはアクティブにならない", () => {
    expect(isAdminNavActive("/admin/login", "/admin")).toBe(false);
    expect(isAdminNavActive("/booking", "/admin")).toBe(false);
  });

  it("末尾スラッシュ付きのパスでも一致する", () => {
    expect(isAdminNavActive("/admin/", "/admin")).toBe(true);
    expect(
      isAdminNavActive("/admin/reservations/new/", "/admin/reservations/new"),
    ).toBe(true);
  });

  // M4bで追加: 設定配下の子画面でも親のナビ項目をアクティブにする
  it("設定ページの配下では親の設定項目がアクティブになる(前方一致)", () => {
    expect(
      isAdminNavActive("/admin/settings/staff", "/admin/settings/staff"),
    ).toBe(true);
    expect(
      isAdminNavActive("/admin/settings/staff/abc", "/admin/settings/staff"),
    ).toBe(true);
  });

  it("パスの区切りをまたがない部分一致ではアクティブにならない", () => {
    // /admin/settings/staff-groups は /admin/settings/staff の配下ではない
    expect(
      isAdminNavActive("/admin/settings/staffs", "/admin/settings/staff"),
    ).toBe(false);
  });

  it("前方一致を足しても /admin は配下でアクティブにならない(既存の回避を維持)", () => {
    expect(isAdminNavActive("/admin/settings/menus", "/admin")).toBe(false);
    expect(isAdminNavActive("/admin/reservations/abc/edit", "/admin")).toBe(
      false,
    );
  });
});
