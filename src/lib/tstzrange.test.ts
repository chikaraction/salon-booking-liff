import { describe, expect, it } from "vitest";

import {
  formatTstzrange,
  formatTstzrangeFrom,
  parseTstzrange,
} from "./tstzrange";

describe("parseTstzrange: PostgRESTが返すtstzrange文字列の変換", () => {
  it("引用符付き・+00オフセットの標準形式を変換する", () => {
    const range = parseTstzrange(
      '["2026-07-18 02:00:00+00","2026-07-18 03:00:00+00")',
    );
    expect(range.start.toISOString()).toBe("2026-07-18T02:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-18T03:00:00.000Z");
  });

  it("+09 など UTC以外のオフセットもUTCのDateに変換する", () => {
    const range = parseTstzrange(
      '["2026-07-18 11:00:00+09","2026-07-18 12:30:00+09")',
    );
    expect(range.start.toISOString()).toBe("2026-07-18T02:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-18T03:30:00.000Z");
  });

  it("引用符なし・+00:00形式・小数秒付きも受け付ける", () => {
    const range = parseTstzrange(
      "[2026-07-18T02:00:00.123+00:00,2026-07-18T03:00:00.456+00:00)",
    );
    expect(range.start.toISOString()).toBe("2026-07-18T02:00:00.123Z");
    expect(range.end.toISOString()).toBe("2026-07-18T03:00:00.456Z");
  });

  it("想定外の形式はエラーにする", () => {
    expect(() => parseTstzrange("")).toThrow();
    expect(() => parseTstzrange("empty")).toThrow();
    // 半開区間 [開始, 終了) 以外はCHECK制約上あり得ないため想定外
    expect(() =>
      parseTstzrange('("2026-07-18 02:00:00+00","2026-07-18 03:00:00+00"]'),
    ).toThrow();
    expect(() => parseTstzrange('["not-a-date","also-not-a-date")')).toThrow();
  });

  it("文字列以外(null・数値・オブジェクト)は型を示すメッセージ付きで例外を投げる", () => {
    // 生成された型では during が unknown になるため、文字列でない値が来たら
    // 何が来たのかが分かるメッセージで落とす
    expect(() => parseTstzrange(null)).toThrow(
      "tstzrangeの値が文字列ではありません(型: null)",
    );
    expect(() => parseTstzrange(123)).toThrow(
      "tstzrangeの値が文字列ではありません(型: number)",
    );
    expect(() => parseTstzrange({ lower: "2026-07-18 02:00:00+00" })).toThrow(
      "tstzrangeの値が文字列ではありません(型: object)",
    );
  });
});

describe("formatTstzrange", () => {
  it("[開始, 終了) の半開区間リテラルにする", () => {
    expect(
      formatTstzrange(
        new Date("2026-07-29T01:00:00.000Z"),
        new Date("2026-07-29T10:00:00.000Z"),
      ),
    ).toBe("[2026-07-29T01:00:00.000Z,2026-07-29T10:00:00.000Z)");
  });

  it("parseTstzrange で元のDateに戻せる", () => {
    const start = new Date("2026-07-29T01:00:00.000Z");
    const end = new Date("2026-07-29T10:00:00.000Z");
    const range = parseTstzrange(formatTstzrange(start, end));
    expect(range.start.toISOString()).toBe(start.toISOString());
    expect(range.end.toISOString()).toBe(end.toISOString());
  });
});

describe("formatTstzrangeFrom", () => {
  it("上限の無い [開始, ∞) の範囲リテラルにする", () => {
    expect(formatTstzrangeFrom(new Date("2026-10-27T00:00:00.000Z"))).toBe(
      "[2026-10-27T00:00:00.000Z,)",
    );
  });
});
