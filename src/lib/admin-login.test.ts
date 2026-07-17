import { describe, expect, it } from "vitest";
import { describeLoginError, validateLoginInput } from "./admin-login";

describe("validateLoginInput(ログイン入力の検証)", () => {
  it("メールとパスワードが揃っていれば ok とトリム済みメールを返す", () => {
    const result = validateLoginInput("  owner@example.com  ", "secret123");
    expect(result).toEqual({
      ok: true,
      email: "owner@example.com",
      password: "secret123",
    });
  });

  it("メールが空(空白のみ含む)ならエラーメッセージを返す", () => {
    expect(validateLoginInput("   ", "secret123")).toEqual({
      ok: false,
      message: "メールアドレスを入力してください",
    });
  });

  it("パスワードが空ならエラーメッセージを返す", () => {
    expect(validateLoginInput("owner@example.com", "")).toEqual({
      ok: false,
      message: "パスワードを入力してください",
    });
  });

  it("パスワードは前後の空白をトリムしない(空白入りパスワードを壊さない)", () => {
    const result = validateLoginInput("owner@example.com", " pass word ");
    expect(result).toEqual({
      ok: true,
      email: "owner@example.com",
      password: " pass word ",
    });
  });

  it("FormData.get の戻り値が文字列以外(null等)ならメール未入力扱いにする", () => {
    expect(validateLoginInput(null, null)).toEqual({
      ok: false,
      message: "メールアドレスを入力してください",
    });
  });
});

describe("describeLoginError(Supabase Authエラーの日本語化)", () => {
  it("invalid_credentials は「メールアドレスまたはパスワードが違います」", () => {
    expect(
      describeLoginError({ code: "invalid_credentials", status: 400 }),
    ).toBe("メールアドレスまたはパスワードが違います");
  });

  it("HTTP 400系(コード不明)も認証情報の誤りとして扱う", () => {
    expect(describeLoginError({ code: undefined, status: 400 })).toBe(
      "メールアドレスまたはパスワードが違います",
    );
  });

  it("その他のエラー(サーバー障害等)は汎用メッセージを返す", () => {
    expect(
      describeLoginError({ code: "unexpected_failure", status: 500 }),
    ).toBe("ログインに失敗しました。時間をおいて再度お試しください");
  });

  it("コードもステータスもない(ネットワーク断等)場合も汎用メッセージを返す", () => {
    expect(describeLoginError({})).toBe(
      "ログインに失敗しました。時間をおいて再度お試しください",
    );
  });
});
