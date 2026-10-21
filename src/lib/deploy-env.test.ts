import { describe, expect, it } from "vitest";

import { checkDeployEnv, type DeployEnvIssue } from "./deploy-env";

/** 本番ビルドとして正しい最小の環境変数 */
const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_LIFF_ID: "1234567890-abcdefgh",
};

const names = (issues: DeployEnvIssue[], level: DeployEnvIssue["level"]) =>
  issues.filter((issue) => issue.level === level).map((issue) => issue.name);

describe("checkDeployEnv: 本番ビルド前の環境変数チェック", () => {
  it("必須の値がそろい、スタブが無効なら問題なし(空の配列)", () => {
    expect(checkDeployEnv(validEnv)).toEqual([]);
  });

  describe("NEXT_PUBLIC_LIFF_STUB(本番ビルドに入れてはいけない)", () => {
    it("1 ならエラー", () => {
      const issues = checkDeployEnv({
        ...validEnv,
        NEXT_PUBLIC_LIFF_STUB: "1",
      });
      expect(names(issues, "error")).toEqual(["NEXT_PUBLIC_LIFF_STUB"]);
      expect(issues[0].message).toContain(
        "本番ビルドでスタブを有効にしてはいけません",
      );
    });

    it("1 以外でも空でなければエラー(0 や true も消し忘れとみなす)", () => {
      for (const value of ["0", "true", "false"]) {
        expect(
          names(
            checkDeployEnv({ ...validEnv, NEXT_PUBLIC_LIFF_STUB: value }),
            "error",
          ),
        ).toEqual(["NEXT_PUBLIC_LIFF_STUB"]);
      }
    });

    it("未設定・空文字・空白だけなら問題なし", () => {
      for (const value of [undefined, "", "  "]) {
        expect(
          checkDeployEnv({ ...validEnv, NEXT_PUBLIC_LIFF_STUB: value }),
        ).toEqual([]);
      }
    });
  });

  describe("Supabase の接続先(必須)", () => {
    it("NEXT_PUBLIC_SUPABASE_URL が未設定ならエラー", () => {
      const env = { ...validEnv, NEXT_PUBLIC_SUPABASE_URL: undefined };
      expect(names(checkDeployEnv(env), "error")).toEqual([
        "NEXT_PUBLIC_SUPABASE_URL",
      ]);
    });

    it("NEXT_PUBLIC_SUPABASE_ANON_KEY が空文字ならエラー", () => {
      expect(
        names(
          checkDeployEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }),
          "error",
        ),
      ).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    });

    it("空白だけの値も空とみなしてエラー", () => {
      expect(
        names(
          checkDeployEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: " " }),
          "error",
        ),
      ).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    });

    it("エラーメッセージに変数名とビルド時に必要なことが書かれている", () => {
      const [issue] = checkDeployEnv({
        ...validEnv,
        NEXT_PUBLIC_SUPABASE_URL: "",
      });
      expect(issue.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(issue.message).toContain("ビルド時");
    });
  });

  describe("NEXT_PUBLIC_LIFF_ID(LIFF作成前の初回デプロイがあるので止めない)", () => {
    it("未設定なら警告(エラーにはしない)", () => {
      const issues = checkDeployEnv({
        ...validEnv,
        NEXT_PUBLIC_LIFF_ID: undefined,
      });
      expect(names(issues, "error")).toEqual([]);
      expect(names(issues, "warning")).toEqual(["NEXT_PUBLIC_LIFF_ID"]);
    });

    it("空文字でも警告", () => {
      expect(
        names(
          checkDeployEnv({ ...validEnv, NEXT_PUBLIC_LIFF_ID: "" }),
          "warning",
        ),
      ).toEqual(["NEXT_PUBLIC_LIFF_ID"]);
    });
  });

  it("SUPABASE_SERVICE_ROLE_KEY はビルド時に無いのが正しいのでチェックしない", () => {
    expect(checkDeployEnv(validEnv)).toEqual([]);
    expect(
      checkDeployEnv({ ...validEnv, SUPABASE_SERVICE_ROLE_KEY: "secret" }),
    ).toEqual([]);
  });

  it("複数の問題はエラー → 警告の順にすべて返す", () => {
    const issues = checkDeployEnv({ NEXT_PUBLIC_LIFF_STUB: "1" });
    expect(issues.map((issue) => [issue.level, issue.name])).toEqual([
      ["error", "NEXT_PUBLIC_LIFF_STUB"],
      ["error", "NEXT_PUBLIC_SUPABASE_URL"],
      ["error", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      ["warning", "NEXT_PUBLIC_LIFF_ID"],
    ]);
  });
});
