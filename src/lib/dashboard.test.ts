import { describe, expect, it } from "vitest";
import {
  PUSH_MONTHLY_FREE_LIMIT,
  PUSH_WARNING_THRESHOLD,
  formatMonthOverMonth,
  formatStaffBreakdown,
  monthRanges,
  pushQuotaMessage,
  pushQuotaShortMessage,
  pushQuotaStatus,
  summarizeTodayByStaff,
} from "./dashboard";

describe("プッシュ無料枠の定数(ADR-002)", () => {
  it("無料枠は200通、警告しきい値は150通", () => {
    expect(PUSH_MONTHLY_FREE_LIMIT).toBe(200);
    expect(PUSH_WARNING_THRESHOLD).toBe(150);
  });
});

describe("monthRanges(今月・先月のJST暦日の範囲)", () => {
  it("月の途中の日から今月と先月の [start, endExclusive) を返す", () => {
    expect(monthRanges("2026-10-20")).toEqual({
      thisMonth: { start: "2026-10-01", endExclusive: "2026-11-01" },
      lastMonth: { start: "2026-09-01", endExclusive: "2026-10-01" },
    });
  });

  it("月初・月末の日でも同じ月の範囲になる", () => {
    expect(monthRanges("2026-10-01").thisMonth).toEqual({
      start: "2026-10-01",
      endExclusive: "2026-11-01",
    });
    expect(monthRanges("2026-10-31").thisMonth).toEqual({
      start: "2026-10-01",
      endExclusive: "2026-11-01",
    });
  });

  it("1月なら先月は前年の12月(年またぎ)", () => {
    expect(monthRanges("2027-01-15")).toEqual({
      thisMonth: { start: "2027-01-01", endExclusive: "2027-02-01" },
      lastMonth: { start: "2026-12-01", endExclusive: "2027-01-01" },
    });
  });

  it("12月の endExclusive は翌年の1月1日", () => {
    expect(monthRanges("2026-12-31")).toEqual({
      thisMonth: { start: "2026-12-01", endExclusive: "2027-01-01" },
      lastMonth: { start: "2026-11-01", endExclusive: "2026-12-01" },
    });
  });
});

describe("formatMonthOverMonth(先月比の文言)", () => {
  it("増えたときは「+」を付ける", () => {
    expect(formatMonthOverMonth(72, 64)).toBe("先月比 +8件");
  });

  it("減ったときは U+2212(マイナス記号)を付ける", () => {
    expect(formatMonthOverMonth(10, 13)).toBe("先月比 −3件");
  });

  it("同数のときは「±0件」", () => {
    expect(formatMonthOverMonth(5, 5)).toBe("先月比 ±0件");
    expect(formatMonthOverMonth(0, 0)).toBe("先月比 ±0件");
  });
});

describe("summarizeTodayByStaff(今日の予約のスタッフ別内訳)", () => {
  const staff = [
    { id: "s2", name: "スタッフB", isActive: true, displayOrder: 2 },
    { id: "s1", name: "スタッフA", isActive: true, displayOrder: 1 },
    { id: "s3", name: "スタッフC", isActive: false, displayOrder: 0 },
  ];

  it("displayOrder 昇順で、スタッフごとの件数を数える", () => {
    expect(summarizeTodayByStaff(["s2", "s1", "s2"], staff)).toEqual([
      { staffId: "s1", name: "スタッフA", count: 1 },
      { staffId: "s2", name: "スタッフB", count: 2 },
    ]);
  });

  it("有効なスタッフは0件でも含める", () => {
    expect(summarizeTodayByStaff([], staff)).toEqual([
      { staffId: "s1", name: "スタッフA", count: 0 },
      { staffId: "s2", name: "スタッフB", count: 0 },
    ]);
  });

  it("無効化済みのスタッフは当日予約が1件以上あるときだけ含める", () => {
    expect(summarizeTodayByStaff(["s3", "s1"], staff)).toEqual([
      { staffId: "s3", name: "スタッフC", count: 1 },
      { staffId: "s1", name: "スタッフA", count: 1 },
      { staffId: "s2", name: "スタッフB", count: 0 },
    ]);
  });

  it("displayOrder が同じときは id 順に並べる", () => {
    const sameOrder = [
      { id: "b", name: "スタッフB", isActive: true, displayOrder: 0 },
      { id: "a", name: "スタッフA", isActive: true, displayOrder: 0 },
    ];
    expect(
      summarizeTodayByStaff([], sameOrder).map((row) => row.staffId),
    ).toEqual(["a", "b"]);
  });

  it("スタッフ一覧に無いIDの予約は内訳に出さない(合計件数はカード側で別に数える)", () => {
    const summary = summarizeTodayByStaff(["unknown", "s1"], staff);
    expect(summary).toEqual([
      { staffId: "s1", name: "スタッフA", count: 1 },
      { staffId: "s2", name: "スタッフB", count: 0 },
    ]);
    // 内訳の合計は予約件数(2件)より少なくなりうる
    expect(summary.reduce((sum, row) => sum + row.count, 0)).toBe(1);
  });

  it("入力の配列を並べ替えない", () => {
    const input = [...staff];
    summarizeTodayByStaff([], input);
    expect(input).toEqual(staff);
  });
});

describe("formatStaffBreakdown(内訳の1行表示)", () => {
  it("「名前 n件」を「 ・ 」で区切ってつなぐ", () => {
    expect(
      formatStaffBreakdown([
        { staffId: "s1", name: "スタッフA", count: 3 },
        { staffId: "s2", name: "スタッフB", count: 0 },
      ]),
    ).toBe("スタッフA 3件 ・ スタッフB 0件");
  });

  it("1人だけなら区切りは付かない", () => {
    expect(
      formatStaffBreakdown([{ staffId: "s1", name: "スタッフA", count: 2 }]),
    ).toBe("スタッフA 2件");
  });

  it("空配列なら空文字", () => {
    expect(formatStaffBreakdown([])).toBe("");
  });
});

describe("pushQuotaStatus(今月のプッシュ送信数の状態)", () => {
  it("0通は ok・残り200通・比率0", () => {
    expect(pushQuotaStatus(0)).toEqual({
      count: 0,
      limit: 200,
      remaining: 200,
      ratio: 0,
      level: "ok",
    });
  });

  it("150通ちょうどは ok(ADR-002「150通を超えたら」なので超えていない)", () => {
    expect(pushQuotaStatus(150)).toMatchObject({
      remaining: 50,
      ratio: 0.75,
      level: "ok",
    });
  });

  it("151通から warning", () => {
    expect(pushQuotaStatus(151)).toMatchObject({
      remaining: 49,
      level: "warning",
    });
  });

  it("200通ちょうどは warning・残り0通・比率1", () => {
    expect(pushQuotaStatus(200)).toMatchObject({
      remaining: 0,
      ratio: 1,
      level: "warning",
    });
  });

  it("201通から over。残りは0未満にせず、比率は1で頭打ち", () => {
    expect(pushQuotaStatus(201)).toEqual({
      count: 201,
      limit: 200,
      remaining: 0,
      ratio: 1,
      level: "over",
    });
    expect(pushQuotaStatus(500)).toMatchObject({ remaining: 0, ratio: 1 });
  });
});

describe("pushQuotaMessage(カードの説明文)", () => {
  it("ok は残り通数と用途", () => {
    expect(pushQuotaMessage(pushQuotaStatus(128))).toBe(
      "残り72通。前日リマインドで使用しています。",
    );
    expect(pushQuotaMessage(pushQuotaStatus(0))).toBe(
      "残り200通。前日リマインドで使用しています。",
    );
  });

  it("warning は150通を超えたことと残り通数", () => {
    expect(pushQuotaMessage(pushQuotaStatus(151))).toBe(
      "今月の送信数が150通を超えました。残り49通です。",
    );
    expect(pushQuotaMessage(pushQuotaStatus(200))).toBe(
      "今月の送信数が150通を超えました。残り0通です。",
    );
  });

  it("over は無料枠を超えたこと", () => {
    expect(pushQuotaMessage(pushQuotaStatus(201))).toBe(
      "無料枠の200通を超えました。超過分は送信できない可能性があります。",
    );
  });
});

describe("pushQuotaShortMessage(サイドバーのミニ集計の短い警告)", () => {
  it("ok は null(警告を出さない)", () => {
    expect(pushQuotaShortMessage(pushQuotaStatus(150))).toBeNull();
  });

  it("warning は「150通を超えました」", () => {
    expect(pushQuotaShortMessage(pushQuotaStatus(151))).toBe(
      "150通を超えました",
    );
  });

  it("over は「無料枠を超えました」", () => {
    expect(pushQuotaShortMessage(pushQuotaStatus(201))).toBe(
      "無料枠を超えました",
    );
  });
});
