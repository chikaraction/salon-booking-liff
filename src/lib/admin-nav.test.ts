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
});
