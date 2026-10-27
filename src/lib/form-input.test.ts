import { describe, expect, it } from "vitest";

import {
  canonicalIntegerInput,
  canonicalTimeInput,
  normalizeTimeInput,
} from "./form-input";

describe("normalizeTimeInput", () => {
  it("DBのtime型(HH:MM:SS)を input[type=time] が扱う HH:MM にする", () => {
    expect(normalizeTimeInput("10:00:00")).toBe("10:00");
  });

  it("すでに HH:MM ならそのまま返す", () => {
    expect(normalizeTimeInput("19:30")).toBe("19:30");
  });

  it("null・空文字は空文字にする(未入力の初期値)", () => {
    expect(normalizeTimeInput(null)).toBe("");
    expect(normalizeTimeInput("")).toBe("");
  });
});

describe("canonicalTimeInput", () => {
  it("前後の空白を落とす", () => {
    expect(canonicalTimeInput("  10:00  ")).toBe("10:00");
  });

  it("時が1桁の入力を2桁に揃える(「9:00」と「09:00」は同じ時刻)", () => {
    expect(canonicalTimeInput("9:00")).toBe("09:00");
  });

  it("DBの秒付き(HH:MM:SS)は秒を落とす", () => {
    expect(canonicalTimeInput("10:00:00")).toBe("10:00");
    expect(canonicalTimeInput("9:30:00")).toBe("09:30");
  });

  it("空文字・空白のみは空文字(未入力)にする", () => {
    expect(canonicalTimeInput("")).toBe("");
    expect(canonicalTimeInput("   ")).toBe("");
  });

  it("時刻として読めない値は前後の空白だけ落として返す(比較はできる)", () => {
    expect(canonicalTimeInput(" 25:99 ")).toBe("25:99");
    expect(canonicalTimeInput(" あ ")).toBe("あ");
  });
});

// 今まで changedStaffFields・changedBookingPolicyFields を通してしか
// 確かめていなかった挙動を、直接の特性化テストで固定する。
describe("canonicalIntegerInput", () => {
  it("前後の空白(タブ・改行を含む)を落とす", () => {
    expect(canonicalIntegerInput(" 30 ")).toBe("30");
    expect(canonicalIntegerInput("\t5\n")).toBe("5");
  });

  it("先頭の0を落として桁を揃える(「030」と「30」は同じ値)", () => {
    expect(canonicalIntegerInput("030")).toBe("30");
    expect(canonicalIntegerInput(" 01 ")).toBe("1");
    expect(canonicalIntegerInput("00")).toBe("0");
  });

  it("空文字・空白のみは空文字(未入力)にする", () => {
    expect(canonicalIntegerInput("")).toBe("");
    expect(canonicalIntegerInput("   ")).toBe("");
  });

  it("符号は数値として揃える(「+5」は「5」、「-0」は「0」)", () => {
    expect(canonicalIntegerInput("-5")).toBe("-5");
    expect(canonicalIntegerInput("+5")).toBe("5");
    expect(canonicalIntegerInput("-0")).toBe("0");
  });

  it("小数点以下が0の値や指数・16進の表記も、整数として読めれば10進に揃える", () => {
    expect(canonicalIntegerInput("1.0")).toBe("1");
    expect(canonicalIntegerInput("1e3")).toBe("1000");
    expect(canonicalIntegerInput("0x10")).toBe("16");
  });

  it("整数として読めない値は前後の空白だけ落として返す(比較はできる)", () => {
    expect(canonicalIntegerInput(" 1.5 ")).toBe("1.5");
    expect(canonicalIntegerInput(" あ ")).toBe("あ");
    expect(canonicalIntegerInput("1 2")).toBe("1 2");
    expect(canonicalIntegerInput("Infinity")).toBe("Infinity");
  });

  it("全角数字は整数として読まず、そのまま返す", () => {
    expect(canonicalIntegerInput("１０")).toBe("１０");
  });
});
