import { describe, expect, it } from "vitest";
import { cn } from "./utils";

// shadcn/ui 導入時に生成された既存ユーティリティの特性化テスト
// (テスト基盤の動作確認を兼ねる)
describe("cn(クラス名結合ユーティリティ)", () => {
  it("複数のクラス名を空白区切りで結合する", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("falsyな値は無視する", () => {
    expect(cn("px-2", undefined, null, false, "py-1")).toBe("px-2 py-1");
  });

  it("競合するTailwindクラスは後勝ちでマージされる", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
