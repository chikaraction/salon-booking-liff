import { describe, expect, it } from "vitest";

import { decideStubToken, STUB_TOKEN_PREFIX } from "./liff-stub";

const devEnv = { stubEnabled: true, isProduction: false };

describe("decideStubToken: 開発用スタブIDトークンの判定", () => {
  it("stub: で始まらないトークンは通常検証(not_stub)", () => {
    expect(decideStubToken("eyJhbGciOi...", devEnv)).toEqual({
      kind: "not_stub",
    });
  });

  it("スタブ有効かつ非本番なら stub: 以降をuserIdとして受理する", () => {
    expect(decideStubToken("stub:U-dev-user-1", devEnv)).toEqual({
      kind: "stub_accepted",
      userId: "U-dev-user-1",
    });
  });

  it("スタブが無効なら stub: トークンを拒否する", () => {
    expect(
      decideStubToken("stub:U-dev-user-1", {
        stubEnabled: false,
        isProduction: false,
      }),
    ).toEqual({ kind: "stub_rejected" });
  });

  it("本番環境ではスタブ有効でも stub: トークンを拒否する", () => {
    expect(
      decideStubToken("stub:U-dev-user-1", {
        stubEnabled: true,
        isProduction: true,
      }),
    ).toEqual({ kind: "stub_rejected" });
  });

  it("userId部分が空(stub: のみ)なら拒否する", () => {
    expect(decideStubToken("stub:", devEnv)).toEqual({
      kind: "stub_rejected",
    });
  });

  it("プレフィックス定数は 'stub:'", () => {
    expect(STUB_TOKEN_PREFIX).toBe("stub:");
  });
});
