import { describe, expect, it } from "vitest";
import { shouldCloseDialogOnKey } from "./dialog-keys";

/** 変換中でも処理済みでもない、ふつうのキー入力 */
const plain = { isComposing: false, keyCode: 0, defaultPrevented: false };

describe("shouldCloseDialogOnKey(このキー入力でダイアログを閉じてよいか)", () => {
  it("Escape を押したら閉じる", () => {
    expect(
      shouldCloseDialogOnKey({ ...plain, key: "Escape", keyCode: 27 }),
    ).toBe(true);
  });

  it("Escape 以外のキーでは閉じない", () => {
    expect(
      shouldCloseDialogOnKey({ ...plain, key: "Enter", keyCode: 13 }),
    ).toBe(false);
    expect(shouldCloseDialogOnKey({ ...plain, key: "a", keyCode: 65 })).toBe(
      false,
    );
    // 旧仕様の "Esc" は古い Edge/IE の値。対象ブラウザは "Escape" を送る
    expect(shouldCloseDialogOnKey({ ...plain, key: "Esc", keyCode: 27 })).toBe(
      false,
    );
  });

  it("日本語入力の変換中(isComposing)の Escape では閉じない(変換の取り消しのため)", () => {
    expect(
      shouldCloseDialogOnKey({
        ...plain,
        key: "Escape",
        isComposing: true,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it("isComposing が false でも keyCode が 229 なら変換中とみなして閉じない(Safari 対策)", () => {
    expect(
      shouldCloseDialogOnKey({ ...plain, key: "Escape", keyCode: 229 }),
    ).toBe(false);
  });

  it("ほかの部品が先に Escape を処理済み(defaultPrevented)なら閉じない", () => {
    // 例: カテゴリ編集のキーボード並べ替え中の Escape は、並べ替えの取り消し
    // (@dnd-kit の KeyboardSensor が preventDefault する)
    expect(
      shouldCloseDialogOnKey({
        ...plain,
        key: "Escape",
        keyCode: 27,
        defaultPrevented: true,
      }),
    ).toBe(false);
  });
});
