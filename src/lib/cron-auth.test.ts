import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron-auth";

const SECRET = "s3cr3t-0123456789abcdef";

describe("isAuthorizedCronRequest(Cron の入口の Bearer 認証)", () => {
  it("「Bearer {秘密}」と完全一致すれば通す", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("Authorization ヘッダーが無ければ通さない", () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
  });

  it("秘密が1文字でも違えば通さない", () => {
    expect(
      isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, -1)}X`, SECRET),
    ).toBe(false);
  });

  it("長さが違えば通さない(前方一致・後ろに余分な文字)", () => {
    expect(
      isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, 5)}`, SECRET),
    ).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it("Bearer の付かない秘密だけ・別の方式(Basic)は通さない", () => {
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("空文字のヘッダーは通さない", () => {
    expect(isAuthorizedCronRequest("", SECRET)).toBe(false);
  });

  it("秘密が空文字なら何が来ても通さない(「Bearer 」だけで通らない)", () => {
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer", "")).toBe(false);
  });

  it("日本語など複数バイトの文字を含む秘密も比較できる", () => {
    expect(isAuthorizedCronRequest("Bearer 秘密の鍵", "秘密の鍵")).toBe(true);
    expect(isAuthorizedCronRequest("Bearer 秘密の錠", "秘密の鍵")).toBe(false);
  });
});
