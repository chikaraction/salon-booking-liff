import { describe, expect, it } from "vitest";

import {
  buildClosureListItems,
  japaneseHolidayName,
  makeIsClosedDay,
  nthWeekdayOfMonth,
  resolveDayClosure,
  type ClosureRules,
} from "./closures";

// ---------------------------------------------------------------------------
// 共通のテストデータ(JST 2026-07-18 は土曜)
// ---------------------------------------------------------------------------

/** 月曜定休(weekday 0=日曜〜6=土曜)。他の曜日は営業 */
const mondayClosed = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isOpen: weekday !== 1,
}));

/** 何も休まないルール(各テストで必要な項目だけ足す) */
function rules(overrides: Partial<ClosureRules> = {}): ClosureRules {
  return {
    businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: true,
    })),
    nthWeekdayClosures: [],
    closeOnHolidays: false,
    overrides: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. 第◯曜日
// ---------------------------------------------------------------------------

describe("nthWeekdayOfMonth: その月の第何◯曜日か", () => {
  it("1日〜7日は第1週", () => {
    expect(nthWeekdayOfMonth("2026-07-01")).toBe(1);
    expect(nthWeekdayOfMonth("2026-07-07")).toBe(1);
  });

  it("8日〜14日は第2週", () => {
    expect(nthWeekdayOfMonth("2026-07-08")).toBe(2);
    expect(nthWeekdayOfMonth("2026-07-14")).toBe(2);
  });

  it("2026-07-19(日)は第3日曜", () => {
    expect(nthWeekdayOfMonth("2026-07-19")).toBe(3);
  });

  it("29日以降は第5週(その曜日の第5週が存在する月のみ)", () => {
    // 2026-08 の日曜は 2/9/16/23/30 なので 8/30 は第5日曜
    expect(nthWeekdayOfMonth("2026-08-30")).toBe(5);
  });

  it("第5週が存在しない月がある(2026-07 の日曜は 5/12/19/26 まで)", () => {
    const july = ["2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26"];
    expect(july.map(nthWeekdayOfMonth)).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// 2. 祝日名
// ---------------------------------------------------------------------------

describe("japaneseHolidayName: 日本の祝日名", () => {
  it("実在の祝日は名前を返す", () => {
    expect(japaneseHolidayName("2026-07-20")).toBe("海の日");
    expect(japaneseHolidayName("2026-09-21")).toBe("敬老の日");
    expect(japaneseHolidayName("2026-01-01")).toBe("元日");
  });

  it("振替休日も祝日として扱う", () => {
    // 2026-05-03(憲法記念日)が日曜のため 5/6 が振替休日
    expect(japaneseHolidayName("2026-05-06")).toBe("振替休日");
  });

  it("祝日でない日は null", () => {
    expect(japaneseHolidayName("2026-07-21")).toBeNull();
    expect(japaneseHolidayName("2026-07-18")).toBeNull();
  });

  it("年をまたいでも算出できる(未来年も含む)", () => {
    expect(japaneseHolidayName("2027-01-01")).toBe("元日");
  });
});

// ---------------------------------------------------------------------------
// 3. 休業日判定(優先順位)
// ---------------------------------------------------------------------------

describe("resolveDayClosure: 休業日判定の優先順位", () => {
  it("どのルールにも当たらない日は営業(理由・ラベルなし)", () => {
    expect(resolveDayClosure("2026-07-18", rules())).toEqual({
      isClosed: false,
      reason: null,
      label: null,
    });
  });

  it("毎週の定休は reason=weekly で休業", () => {
    // 2026-07-20 は月曜
    expect(
      resolveDayClosure("2026-07-20", rules({ businessHours: mondayClosed })),
    ).toEqual({ isClosed: true, reason: "weekly", label: null });
  });

  it("営業時間の行がない曜日も休業として扱う(既存の判定と同じ)", () => {
    expect(
      resolveDayClosure(
        "2026-07-18",
        rules({ businessHours: [{ weekday: 1, isOpen: true }] }),
      ),
    ).toEqual({ isClosed: true, reason: "weekly", label: null });
  });

  it("第◯曜日の定休は reason=nth-weekday で休業", () => {
    // 2026-07-19 は第3日曜
    expect(
      resolveDayClosure(
        "2026-07-19",
        rules({ nthWeekdayClosures: [{ weekday: 0, nth: 3 }] }),
      ),
    ).toEqual({ isClosed: true, reason: "nth-weekday", label: null });
  });

  it("第◯曜日の定休は同じ曜日でも週が違えば効かない", () => {
    const withNth = rules({ nthWeekdayClosures: [{ weekday: 0, nth: 3 }] });
    // 2026-07-12 は第2日曜
    expect(resolveDayClosure("2026-07-12", withNth).isClosed).toBe(false);
  });

  it("祝日は reason=holiday・ラベルは祝日名(「・祝日」は付けない)", () => {
    expect(
      resolveDayClosure("2026-07-20", rules({ closeOnHolidays: true })),
    ).toEqual({ isClosed: true, reason: "holiday", label: "海の日" });
  });

  it("「祝日を休業にする」がOFFなら祝日でも営業のまま", () => {
    expect(resolveDayClosure("2026-07-20", rules()).isClosed).toBe(false);
  });

  it("祝日は第◯曜日の定休より強い(祝日名がラベルに出る)", () => {
    // 2026-09-21(敬老の日)は第3月曜
    expect(
      resolveDayClosure(
        "2026-09-21",
        rules({
          closeOnHolidays: true,
          nthWeekdayClosures: [{ weekday: 1, nth: 3 }],
        }),
      ),
    ).toEqual({ isClosed: true, reason: "holiday", label: "敬老の日" });
  });

  it("第◯曜日の定休は毎週の定休より強い(reason で区別できる)", () => {
    // 2026-07-20 は月曜(毎週の定休)かつ第3月曜
    expect(
      resolveDayClosure(
        "2026-07-20",
        rules({
          businessHours: mondayClosed,
          nthWeekdayClosures: [{ weekday: 1, nth: 3 }],
        }),
      ).reason,
    ).toBe("nth-weekday");
  });

  it("日付上書き(休業)はもっとも強く、ラベルもそのまま返す", () => {
    expect(
      resolveDayClosure(
        "2026-07-20",
        rules({
          closeOnHolidays: true,
          overrides: [
            {
              startDate: "2026-07-20",
              endDate: "2026-07-20",
              isOpen: false,
              label: "臨時休業",
            },
          ],
        }),
      ),
    ).toEqual({ isClosed: true, reason: "override", label: "臨時休業" });
  });

  it("日付上書き(営業)は祝日・定休を打ち消す(reason は override のまま)", () => {
    expect(
      resolveDayClosure(
        "2026-07-20",
        rules({
          businessHours: mondayClosed,
          closeOnHolidays: true,
          overrides: [
            {
              startDate: "2026-07-20",
              endDate: "2026-07-20",
              isOpen: true,
              label: "祝日営業",
            },
          ],
        }),
      ),
    ).toEqual({ isClosed: false, reason: "override", label: "祝日営業" });
  });

  it("日付上書きは範囲の両端を含む(半開区間ではない)", () => {
    const summer = rules({
      overrides: [
        {
          startDate: "2026-08-13",
          endDate: "2026-08-16",
          isOpen: false,
          label: "夏季休業",
        },
      ],
    });
    expect(resolveDayClosure("2026-08-12", summer).isClosed).toBe(false);
    expect(resolveDayClosure("2026-08-13", summer).isClosed).toBe(true);
    expect(resolveDayClosure("2026-08-16", summer).isClosed).toBe(true);
    expect(resolveDayClosure("2026-08-17", summer).isClosed).toBe(false);
  });

  it("ラベルが未入力の上書きは label が null のまま", () => {
    expect(
      resolveDayClosure(
        "2026-07-29",
        rules({
          overrides: [
            {
              startDate: "2026-07-29",
              endDate: "2026-07-29",
              isOpen: false,
              label: null,
            },
          ],
        }),
      ).label,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. buildWeekView / isSelectableDate へ渡す判定関数
//    (admin-calendar.ts の isClosedByBusinessHours から移した特性化テスト込み)
// ---------------------------------------------------------------------------

describe("makeIsClosedDay: 休業日判定の関数化", () => {
  const businessHours = [
    { weekday: 0, isOpen: false },
    { weekday: 6, isOpen: true },
  ];
  const isClosedDay = makeIsClosedDay(rules({ businessHours }));

  it("is_open=false の曜日は休業", () => {
    // 2026-07-12 は日曜
    expect(isClosedDay("2026-07-12")).toBe(true);
  });

  it("行がない曜日は休業として扱う(booking-data と同じ判定)", () => {
    // 2026-07-13 は月曜(行なし)
    expect(isClosedDay("2026-07-13")).toBe(true);
  });

  it("is_open=true の曜日は営業", () => {
    // 2026-07-18 は土曜
    expect(isClosedDay("2026-07-18")).toBe(false);
  });

  it("第◯曜日・祝日・日付上書きも同じ関数で効く", () => {
    const closed = makeIsClosedDay(
      rules({
        closeOnHolidays: true,
        nthWeekdayClosures: [{ weekday: 0, nth: 3 }],
        overrides: [
          {
            startDate: "2026-07-29",
            endDate: "2026-07-29",
            isOpen: false,
            label: "臨時休業",
          },
        ],
      }),
    );
    expect(closed("2026-07-19")).toBe(true); // 第3日曜
    expect(closed("2026-07-20")).toBe(true); // 海の日
    expect(closed("2026-07-29")).toBe(true); // 臨時休業
    expect(closed("2026-07-18")).toBe(false); // 通常の営業日
  });
});

// ---------------------------------------------------------------------------
// 5. モックE-2下部の混在リスト
// ---------------------------------------------------------------------------

describe("buildClosureListItems: 臨時休業・祝日の混在リスト", () => {
  it("単日の臨時休業は「7月29日(水)」+ バッジ「臨時休」", () => {
    expect(
      buildClosureListItems({
        from: "2026-07-01",
        days: 31,
        rules: rules({
          overrides: [
            {
              startDate: "2026-07-29",
              endDate: "2026-07-29",
              isOpen: false,
              label: "臨時休業",
            },
          ],
        }),
      }),
    ).toEqual([
      {
        dateRangeLabel: "7月29日(水)",
        label: "臨時休業",
        badge: "臨時休",
      },
    ]);
  });

  it("複数日の休業は1行にまとめ、バッジは「連休」", () => {
    expect(
      buildClosureListItems({
        from: "2026-08-01",
        days: 31,
        rules: rules({
          overrides: [
            {
              startDate: "2026-08-13",
              endDate: "2026-08-16",
              isOpen: false,
              label: "夏季休業",
            },
          ],
        }),
      }),
    ).toEqual([
      {
        dateRangeLabel: "8月13日(木)〜16日(日)",
        label: "夏季休業",
        badge: "連休",
      },
    ]);
  });

  it("月をまたぐ範囲は終端も月から表記する", () => {
    const [item] = buildClosureListItems({
      from: "2026-08-01",
      days: 62,
      rules: rules({
        overrides: [
          {
            startDate: "2026-08-30",
            endDate: "2026-09-02",
            isOpen: false,
            label: "改装",
          },
        ],
      }),
    });
    expect(item.dateRangeLabel).toBe("8月30日(日)〜9月2日(水)");
  });

  it("臨時営業(is_open=true)はバッジ「臨時営業」", () => {
    const [item] = buildClosureListItems({
      from: "2026-07-01",
      days: 31,
      rules: rules({
        overrides: [
          {
            startDate: "2026-07-20",
            endDate: "2026-07-20",
            isOpen: true,
            label: "祝日営業",
          },
        ],
      }),
    });
    expect(item.badge).toBe("臨時営業");
  });

  it("ラベル未入力の上書きは空文字にする", () => {
    const [item] = buildClosureListItems({
      from: "2026-07-01",
      days: 31,
      rules: rules({
        overrides: [
          {
            startDate: "2026-07-29",
            endDate: "2026-07-29",
            isOpen: false,
            label: null,
          },
        ],
      }),
    });
    expect(item.label).toBe("");
  });

  it("祝日は「祝日を休業にする」がONのときだけ載る", () => {
    const params = { from: "2026-07-01", days: 31 };
    expect(buildClosureListItems({ ...params, rules: rules() })).toEqual([]);
    expect(
      buildClosureListItems({
        ...params,
        rules: rules({ closeOnHolidays: true }),
      }),
    ).toEqual([
      {
        dateRangeLabel: "7月20日(月)",
        label: "海の日・祝日",
        badge: "休業",
      },
    ]);
  });

  it("臨時営業で上書きされた祝日は載せない", () => {
    expect(
      buildClosureListItems({
        from: "2026-07-01",
        days: 31,
        rules: rules({
          closeOnHolidays: true,
          overrides: [
            {
              startDate: "2026-07-20",
              endDate: "2026-07-20",
              isOpen: true,
              label: "祝日営業",
            },
          ],
        }),
      }),
    ).toEqual([
      {
        dateRangeLabel: "7月20日(月)",
        label: "祝日営業",
        badge: "臨時営業",
      },
    ]);
  });

  it("毎週の定休・第◯曜日の定休はリストに載せない(上部の別UIが担当)", () => {
    expect(
      buildClosureListItems({
        from: "2026-07-01",
        days: 31,
        rules: rules({
          businessHours: mondayClosed,
          nthWeekdayClosures: [{ weekday: 0, nth: 3 }],
        }),
      }),
    ).toEqual([]);
  });

  it("日付順に並べる(祝日と臨時休業が混ざっても)", () => {
    const items = buildClosureListItems({
      from: "2026-07-01",
      days: 62,
      rules: rules({
        closeOnHolidays: true,
        overrides: [
          {
            startDate: "2026-07-29",
            endDate: "2026-07-29",
            isOpen: false,
            label: "臨時休業",
          },
          {
            startDate: "2026-08-13",
            endDate: "2026-08-16",
            isOpen: false,
            label: "夏季休業",
          },
        ],
      }),
    });
    expect(items.map((item) => item.dateRangeLabel)).toEqual([
      "7月20日(月)", // 海の日
      "7月29日(水)", // 臨時休業
      "8月11日(火)", // 山の日
      "8月13日(木)〜16日(日)", // 夏季休業
    ]);
  });

  it("期間は from から days 日ぶん(末日を含む)", () => {
    const summer = rules({
      overrides: [
        {
          startDate: "2026-08-13",
          endDate: "2026-08-16",
          isOpen: false,
          label: "夏季休業",
        },
      ],
    });
    // 末日 = 8/12 → 範囲に掛からない
    expect(
      buildClosureListItems({ from: "2026-08-01", days: 12, rules: summer }),
    ).toEqual([]);
    // 末日 = 8/13 → 範囲に掛かる(1日でも重なれば載せる)
    expect(
      buildClosureListItems({ from: "2026-08-01", days: 13, rules: summer }),
    ).toHaveLength(1);
    // 開始日 = 8/16 → 範囲に掛かる
    expect(
      buildClosureListItems({ from: "2026-08-16", days: 1, rules: summer }),
    ).toHaveLength(1);
    // 開始日 = 8/17 → 終わっている
    expect(
      buildClosureListItems({ from: "2026-08-17", days: 1, rules: summer }),
    ).toEqual([]);
  });
});
