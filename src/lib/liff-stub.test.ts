import { describe, expect, it } from "vitest";

import {
  decideStubToken,
  DEFAULT_STUB_USER_ID,
  STUB_TOKEN_PREFIX,
  STUB_USER_ID_STORAGE_KEY,
  stubIdTokenFor,
} from "./liff-stub";

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

describe("stubIdTokenFor: 客の上書きの値からスタブIDトークンを作る", () => {
  it("上書きの値があれば、その値をuserIdにしたスタブトークンにする", () => {
    expect(stubIdTokenFor("U-e2e-customer-a")).toBe("stub:U-e2e-customer-a");
  });

  it("上書きの値の前後の空白は取り除く", () => {
    expect(stubIdTokenFor("  U-e2e-customer-a\n")).toBe(
      "stub:U-e2e-customer-a",
    );
  });

  it("上書きが無い(null)なら既定の客 U-dev-user-1 にする", () => {
    expect(stubIdTokenFor(null)).toBe("stub:U-dev-user-1");
  });

  it("上書きが空文字なら既定の客にする", () => {
    expect(stubIdTokenFor("")).toBe("stub:U-dev-user-1");
  });

  it("上書きが前後の空白だけなら空とみなして既定の客にする", () => {
    expect(stubIdTokenFor(" \t ")).toBe("stub:U-dev-user-1");
  });

  it("作ったトークンは decideStubToken で上書きの値をuserIdとして受理される", () => {
    expect(decideStubToken(stubIdTokenFor("U-e2e-customer-b"), devEnv)).toEqual(
      { kind: "stub_accepted", userId: "U-e2e-customer-b" },
    );
  });

  it("既定の客は 'U-dev-user-1'、localStorageのキーは 'liff-stub-user-id'", () => {
    expect(DEFAULT_STUB_USER_ID).toBe("U-dev-user-1");
    expect(STUB_USER_ID_STORAGE_KEY).toBe("liff-stub-user-id");
  });
});
