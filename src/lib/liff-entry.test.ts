import { describe, expect, it } from "vitest";

import { decideLiffEntry } from "./liff-entry";

const lineMode = { stubMode: false };

describe("decideLiffEntry: LIFF のエントリーページ(/)の振り分け", () => {
  describe("liff.state なし(https://liff.line.me/{LIFF ID} を直接開いた等)", () => {
    it("/booking へ遷移する", () => {
      expect(decideLiffEntry("", lineMode)).toEqual({
        kind: "redirect",
        path: "/booking",
      });
    });

    it("liff.state 以外のクエリがあっても /booking へ", () => {
      expect(decideLiffEntry("?foo=1&liff.hback=2", lineMode)).toEqual({
        kind: "redirect",
        path: "/booking",
      });
    });
  });

  describe("liff.state あり(https://liff.line.me/{LIFF ID}/my などから来た)", () => {
    it("SDK の2次リダイレクトに任せる(自分では遷移しない)", () => {
      expect(decideLiffEntry("?liff.state=%2Fmy", lineMode)).toEqual({
        kind: "wait_for_sdk",
      });
    });

    it("先頭の ? が無いクエリ文字列も受け付ける", () => {
      expect(decideLiffEntry("liff.state=%2Fmy", lineMode)).toEqual({
        kind: "wait_for_sdk",
      });
    });

    it("URLSearchParams も受け付ける", () => {
      expect(
        decideLiffEntry(
          new URLSearchParams({ "liff.state": "/booking?change=abc" }),
          lineMode,
        ),
      ).toEqual({ kind: "wait_for_sdk" });
    });

    it("liff.state が空文字でも SDK に任せる(SDK は値が文字列なら処理する)", () => {
      expect(decideLiffEntry("?liff.state=", lineMode)).toEqual({
        kind: "wait_for_sdk",
      });
    });
  });

  describe("スタブモード(NEXT_PUBLIC_LIFF_STUB=1。LIFF SDK を使わない)", () => {
    it("liff.state が無ければ /booking へ", () => {
      expect(decideLiffEntry("", { stubMode: true })).toEqual({
        kind: "redirect",
        path: "/booking",
      });
    });

    it("liff.state があっても常に /booking へ(SDK のリダイレクトは起きない)", () => {
      expect(decideLiffEntry("?liff.state=%2Fmy", { stubMode: true })).toEqual({
        kind: "redirect",
        path: "/booking",
      });
    });
  });

  describe("LIFF の初期化に失敗した(LIFF ID 未設定・LINE の外で開いた等)", () => {
    it("liff.state があっても SDK は遷移させないので /booking へ(案内はそちらで出す)", () => {
      expect(
        decideLiffEntry("?liff.state=%2Fmy", {
          stubMode: false,
          initFailed: true,
        }),
      ).toEqual({ kind: "redirect", path: "/booking" });
    });

    it("liff.state が無ければ /booking へ", () => {
      expect(
        decideLiffEntry("", { stubMode: false, initFailed: true }),
      ).toEqual({ kind: "redirect", path: "/booking" });
    });
  });
});
