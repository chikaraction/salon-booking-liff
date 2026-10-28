import { describe, expect, it } from "vitest";

import { decideAdminAccess, type AdminAccessRequest } from "./admin-access";

/** 普通の画面の要求(ブラウザでページを開く GET) */
function pageRequest(
  pathname: string,
  isLoggedIn: boolean,
): AdminAccessRequest {
  return { pathname, isLoggedIn, method: "GET", hasActionHeader: false };
}

/** fetch で送る Server Action の要求(POST + next-action ヘッダー) */
function actionRequest(
  pathname: string,
  isLoggedIn: boolean,
): AdminAccessRequest {
  return { pathname, isLoggedIn, method: "POST", hasActionHeader: true };
}

describe("decideAdminAccess: /admin 配下のアクセス制御の振り分け", () => {
  // 修正前の middleware.ts の挙動を固定する(特性化テスト)
  describe("普通の画面の要求", () => {
    it("未ログインで /admin を開くとログイン画面へリダイレクトする", () => {
      expect(decideAdminAccess(pageRequest("/admin", false))).toEqual({
        kind: "redirect",
        path: "/admin/login",
      });
    });

    it("未ログインで /admin 配下の画面を開くとログイン画面へリダイレクトする", () => {
      expect(
        decideAdminAccess(pageRequest("/admin/settings/business", false)),
      ).toEqual({ kind: "redirect", path: "/admin/login" });
    });

    it("未ログインでログイン画面を開くとそのまま通す", () => {
      expect(decideAdminAccess(pageRequest("/admin/login", false))).toEqual({
        kind: "pass",
      });
    });

    it("ログイン済みでログイン画面を開くと /admin へリダイレクトする", () => {
      expect(decideAdminAccess(pageRequest("/admin/login", true))).toEqual({
        kind: "redirect",
        path: "/admin",
      });
    });

    it("ログイン済みで /admin や配下の画面を開くとそのまま通す", () => {
      expect(decideAdminAccess(pageRequest("/admin", true))).toEqual({
        kind: "pass",
      });
      expect(
        decideAdminAccess(pageRequest("/admin/settings/business", true)),
      ).toEqual({ kind: "pass" });
    });
  });

  describe("Server Action の要求", () => {
    it("POST + next-action ヘッダーでログインが切れていたら、Server Action 向けにログイン画面へ", () => {
      expect(
        decideAdminAccess(actionRequest("/admin/settings/business", false)),
      ).toEqual({ kind: "action_redirect", path: "/admin/login" });
    });

    it("ログイン済みでログイン画面への Server Action は、Server Action 向けに /admin へ", () => {
      expect(decideAdminAccess(actionRequest("/admin/login", true))).toEqual({
        kind: "action_redirect",
        path: "/admin",
      });
    });

    it("ログイン済みで /admin 配下への Server Action はそのまま通す", () => {
      expect(
        decideAdminAccess(actionRequest("/admin/settings/business", true)),
      ).toEqual({ kind: "pass" });
    });

    it("未ログインでログイン画面への Server Action(ログイン操作)はそのまま通す", () => {
      expect(decideAdminAccess(actionRequest("/admin/login", false))).toEqual({
        kind: "pass",
      });
    });

    it("GET に next-action ヘッダーがあっても Server Action とみなさず、普通のリダイレクト", () => {
      expect(
        decideAdminAccess({
          pathname: "/admin/settings/business",
          isLoggedIn: false,
          method: "GET",
          hasActionHeader: true,
        }),
      ).toEqual({ kind: "redirect", path: "/admin/login" });
    });

    it("POST でもヘッダーが無ければ(JS なしのフォーム送信)普通のリダイレクトのまま", () => {
      expect(
        decideAdminAccess({
          pathname: "/admin/settings/business",
          isLoggedIn: false,
          method: "POST",
          hasActionHeader: false,
        }),
      ).toEqual({ kind: "redirect", path: "/admin/login" });
    });
  });
});
