import { describe, expect, it } from "vitest";

import type { BusinessDay, StaffWorkingDay } from "./availability";
import {
  buildClosureListItems,
  closedWeekdaysOf,
  japaneseHolidayName,
  makeBusinessDayOf,
  makeIsClosedDay,
  nthWeekdayOfMonth,
  resolveBusinessDay,
  resolveDayClosure,
  resolveStaffWorkingDay,
  weeklyBusinessDayOf,
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
              openTime: null,
              closeTime: null,
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
              openTime: null,
              closeTime: null,
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
          openTime: null,
          closeTime: null,
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
              openTime: null,
              closeTime: null,
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
            openTime: null,
            closeTime: null,
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
              openTime: null,
              closeTime: null,
            },
          ],
        }),
      }),
    ).toEqual([
      {
        dateRangeLabel: "7月29日(水)",
        label: "臨時休業",
        badge: "臨時休",
        overrideId: null,
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
              openTime: null,
              closeTime: null,
            },
          ],
        }),
      }),
    ).toEqual([
      {
        dateRangeLabel: "8月13日(木)〜16日(日)",
        label: "夏季休業",
        badge: "連休",
        overrideId: null,
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
            openTime: null,
            closeTime: null,
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
            openTime: null,
            closeTime: null,
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
            openTime: null,
            closeTime: null,
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
        overrideId: null,
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
              openTime: null,
              closeTime: null,
            },
          ],
        }),
      }),
    ).toEqual([
      {
        dateRangeLabel: "7月20日(月)",
        label: "祝日営業",
        badge: "臨時営業",
        overrideId: null,
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
            openTime: null,
            closeTime: null,
          },
          {
            startDate: "2026-08-13",
            endDate: "2026-08-16",
            isOpen: false,
            label: "夏季休業",
            openTime: null,
            closeTime: null,
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
          openTime: null,
          closeTime: null,
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

  // overrideId は「その行がどの登録データから出たか」を持つ。設定画面の削除は
  // これだけを見る(バッジ・並び順から突き合わせる推測をしない)
  it("上書き由来の行には、その上書きのIDが載る", () => {
    const items = buildClosureListItems({
      from: "2026-07-01",
      days: 62,
      rules: rules({
        closeOnHolidays: true,
        overrides: [
          {
            id: "summer",
            startDate: "2026-08-13",
            endDate: "2026-08-16",
            isOpen: false,
            label: "夏季休業",
            openTime: null,
            closeTime: null,
          },
          {
            id: "spot",
            startDate: "2026-07-29",
            endDate: "2026-07-29",
            isOpen: false,
            label: "臨時休業",
            openTime: null,
            closeTime: null,
          },
        ],
      }),
    });
    // 7/20(海の日)→ 7/29(臨時休)→ 8/11(山の日)→ 8/13〜16(連休)
    expect(items.map((item) => item.overrideId)).toEqual([
      null,
      "spot",
      null,
      "summer",
    ]);
  });

  it("祝日由来の行は自動導出なので overrideId が null", () => {
    const [item] = buildClosureListItems({
      from: "2026-07-01",
      days: 31,
      rules: rules({ closeOnHolidays: true }),
    });
    expect(item.label).toBe("海の日・祝日");
    expect(item.overrideId).toBeNull();
  });

  it("IDを渡さない呼び出し(枠計算・管理画面カレンダー)では overrideId が null", () => {
    const [item] = buildClosureListItems({
      from: "2026-07-01",
      days: 31,
      rules: rules({
        overrides: [
          {
            startDate: "2026-07-29",
            endDate: "2026-07-29",
            isOpen: false,
            label: "臨時休業",
            openTime: null,
            closeTime: null,
          },
        ],
      }),
    });
    expect(item.overrideId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. 臨時営業日の営業時間(date_overrides の open_time / close_time)
// ---------------------------------------------------------------------------

describe("resolveBusinessDay: その日の営業時間を確定する", () => {
  /** 営業曜日の営業時間(business_hours の1行) */
  const weekly: BusinessDay = {
    isOpen: true,
    openTime: "10:00:00",
    closeTime: "18:00:00",
  };
  /** 定休曜日(business_hours が休業なので時刻を持たない) */
  const weeklyClosed: BusinessDay = {
    isOpen: false,
    openTime: null,
    closeTime: null,
  };
  const closed: BusinessDay = {
    isOpen: false,
    openTime: null,
    closeTime: null,
  };

  it("どのルールにも当たらない日は曜日の営業時間をそのまま返す", () => {
    expect(
      resolveBusinessDay({
        date: "2026-07-18",
        weeklyBusinessDay: weekly,
        rules: rules(),
      }),
    ).toEqual(weekly);
  });

  it("毎週の定休の日は閉じる", () => {
    // 2026-07-20 は月曜
    expect(
      resolveBusinessDay({
        date: "2026-07-20",
        weeklyBusinessDay: weeklyClosed,
        rules: rules({ businessHours: mondayClosed }),
      }),
    ).toEqual(closed);
  });

  it("第◯曜日の定休・祝日の日も閉じる(曜日は営業でも)", () => {
    const nthAndHoliday = rules({
      nthWeekdayClosures: [{ weekday: 0, nth: 3 }],
      closeOnHolidays: true,
    });
    // 2026-07-19 は第3日曜 / 2026-07-20 は海の日
    expect(
      resolveBusinessDay({
        date: "2026-07-19",
        weeklyBusinessDay: weekly,
        rules: nthAndHoliday,
      }),
    ).toEqual(closed);
    expect(
      resolveBusinessDay({
        date: "2026-07-20",
        weeklyBusinessDay: weekly,
        rules: nthAndHoliday,
      }),
    ).toEqual(closed);
  });

  it("休業の上書き(臨時休業)は営業曜日でも閉じる", () => {
    expect(
      resolveBusinessDay({
        date: "2026-07-29",
        weeklyBusinessDay: weekly,
        rules: rules({
          overrides: [
            {
              startDate: "2026-07-29",
              endDate: "2026-07-29",
              isOpen: false,
              label: "臨時休業",
              openTime: null,
              closeTime: null,
            },
          ],
        }),
      }),
    ).toEqual(closed);
  });

  it("定休曜日でも時刻付きの臨時営業ならその時刻で営業する", () => {
    // 毎週水曜が定休の店で、2026-07-29(水)だけ 11:00〜16:00 で営業する
    const wednesdayClosed = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: weekday !== 3,
    }));
    expect(
      resolveBusinessDay({
        date: "2026-07-29",
        weeklyBusinessDay: weeklyClosed,
        rules: rules({
          businessHours: wednesdayClosed,
          overrides: [
            {
              startDate: "2026-07-29",
              endDate: "2026-07-29",
              isOpen: true,
              label: "臨時営業",
              openTime: "11:00:00",
              closeTime: "16:00:00",
            },
          ],
        }),
      }),
    ).toEqual({
      isOpen: true,
      openTime: "11:00:00",
      closeTime: "16:00:00",
    });
  });

  it("営業曜日に時刻付きの臨時営業を重ねると短縮営業になる", () => {
    expect(
      resolveBusinessDay({
        date: "2026-07-18",
        weeklyBusinessDay: weekly,
        rules: rules({
          overrides: [
            {
              startDate: "2026-07-18",
              endDate: "2026-07-18",
              isOpen: true,
              label: "短縮営業",
              openTime: "10:00:00",
              closeTime: "14:00:00",
            },
          ],
        }),
      }),
    ).toEqual({
      isOpen: true,
      openTime: "10:00:00",
      closeTime: "14:00:00",
    });
  });

  it("時刻なしの臨時営業(祝日の打ち消し)は曜日の営業時間を使う", () => {
    expect(
      resolveBusinessDay({
        date: "2026-07-20",
        weeklyBusinessDay: weekly,
        rules: rules({
          closeOnHolidays: true,
          overrides: [
            {
              startDate: "2026-07-20",
              endDate: "2026-07-20",
              isOpen: true,
              label: "祝日営業",
              openTime: null,
              closeTime: null,
            },
          ],
        }),
      }),
    ).toEqual(weekly);
  });

  it("複数日の臨時営業は範囲内のどの日にも同じ時刻が効く(両端を含む)", () => {
    const goldenWeek = rules({
      businessHours: mondayClosed,
      overrides: [
        {
          startDate: "2026-05-04",
          endDate: "2026-05-06",
          isOpen: true,
          label: "連休営業",
          openTime: "09:00:00",
          closeTime: "17:00:00",
        },
      ],
    });
    // 2026-05-04 は月曜(定休)。範囲の両端とも臨時営業の時刻で営業する
    const days = ["2026-05-04", "2026-05-06"].map((date) =>
      resolveBusinessDay({
        date,
        weeklyBusinessDay: date === "2026-05-04" ? weeklyClosed : weekly,
        rules: goldenWeek,
      }),
    );
    expect(days).toEqual([
      { isOpen: true, openTime: "09:00:00", closeTime: "17:00:00" },
      { isOpen: true, openTime: "09:00:00", closeTime: "17:00:00" },
    ]);
    // 範囲外(5/7・木)は曜日の営業時間に戻る
    expect(
      resolveBusinessDay({
        date: "2026-05-07",
        weeklyBusinessDay: weekly,
        rules: goldenWeek,
      }),
    ).toEqual(weekly);
  });

  it("時刻を持つ上書きでも休業判定(resolveDayClosure)は変わらない", () => {
    // 営業時間は resolveBusinessDay の責務で、休業判定には影響しない
    const withHours = rules({
      businessHours: mondayClosed,
      overrides: [
        {
          startDate: "2026-07-20",
          endDate: "2026-07-20",
          isOpen: true,
          label: "臨時営業",
          openTime: "11:00:00",
          closeTime: "16:00:00",
        },
      ],
    });
    expect(resolveDayClosure("2026-07-20", withHours)).toEqual({
      isClosed: false,
      reason: "override",
      label: "臨時営業",
    });
    expect(makeIsClosedDay(withHours)("2026-07-20")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. 定休曜日を臨時営業にした日の勤務扱い
// ---------------------------------------------------------------------------

describe("resolveStaffWorkingDay: 臨時営業日のスタッフ勤務パターン", () => {
  /** 営業曜日の営業時間 */
  const weeklyOpen: BusinessDay = {
    isOpen: true,
    openTime: "10:00:00",
    closeTime: "18:00:00",
  };
  /** 定休曜日(business_hours が休業なので時刻を持たない) */
  const weeklyClosed: BusinessDay = {
    isOpen: false,
    openTime: null,
    closeTime: null,
  };
  /** 時刻付きの臨時営業で開いた日の実効営業時間 */
  const specialOpen: BusinessDay = {
    isOpen: true,
    openTime: "10:00:00",
    closeTime: "15:00:00",
  };
  const closed: BusinessDay = {
    isOpen: false,
    openTime: null,
    closeTime: null,
  };
  /** その曜日の勤務パターンを持つスタッフ */
  const weeklyWorking: StaffWorkingDay = {
    startTime: "10:00:00",
    endTime: "18:00:00",
    breakStart: "13:00:00",
    breakEnd: "14:00:00",
  };

  it("その曜日の勤務パターンがあればそれをそのまま返す(通常の営業日)", () => {
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-18",
        weeklyWorking,
        weeklyBusinessDay: weeklyOpen,
        businessDay: weeklyOpen,
      }),
    ).toEqual(weeklyWorking);
  });

  it("その曜日の勤務パターンが無い通常の営業日は勤務なし(null)", () => {
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-18",
        weeklyWorking: null,
        weeklyBusinessDay: weeklyOpen,
        businessDay: weeklyOpen,
      }),
    ).toBeNull();
  });

  it("定休曜日を時刻付きで臨時営業にした日は、勤務行の無いスタッフを営業時間いっぱいの勤務(休憩なし)とみなす", () => {
    // 毎週月曜が定休の店で、2026-07-20(月)だけ 10:00〜15:00 で臨時営業する。
    // 月曜の staff_working_hours は誰にも無いので、そのままでは枠が1つも出ない
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-20",
        weeklyWorking: null,
        weeklyBusinessDay: weeklyClosed,
        businessDay: specialOpen,
      }),
    ).toEqual({
      startTime: "10:00:00",
      endTime: "15:00:00",
      breakStart: null,
      breakEnd: null,
    });
  });

  it("定休曜日の臨時営業でも、その曜日の勤務行を持つスタッフはその勤務行が優先される", () => {
    // 月曜が定休でも個人的に月曜の勤務行が入っているスタッフは、
    // 休憩込みのその勤務パターンで枠が出る
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-20",
        weeklyWorking,
        weeklyBusinessDay: weeklyClosed,
        businessDay: specialOpen,
      }),
    ).toEqual(weeklyWorking);
  });

  it("営業曜日の短縮営業では勤務扱いにしない(その曜日が休みのスタッフは休みのまま)", () => {
    // 水曜は営業曜日。2026-07-29(水)を 10:00〜15:00 の短縮営業にしても、
    // 水曜の勤務行が無いスタッフは出勤しない
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-29",
        weeklyWorking: null,
        weeklyBusinessDay: weeklyOpen,
        businessDay: specialOpen,
      }),
    ).toBeNull();
  });

  it("祝日の打ち消し(時刻なしの臨時営業)でも勤務扱いにしない(元から営業曜日のため)", () => {
    // 2026-07-20(海の日)を「祝日だが営業する」で開けても、
    // 月曜が営業曜日である以上は通常の勤務パターンに従う
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-20",
        weeklyWorking: null,
        weeklyBusinessDay: weeklyOpen,
        businessDay: weeklyOpen,
      }),
    ).toBeNull();
  });

  it("休業日は勤務なし(null)", () => {
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-20",
        weeklyWorking: null,
        weeklyBusinessDay: weeklyClosed,
        businessDay: closed,
      }),
    ).toBeNull();
  });

  it("休業日は、その曜日の勤務行を持つスタッフでも勤務行をそのまま返す(休業判定は businessDay 側の責務)", () => {
    // 休業かどうかは computeStaffDaySlots が businessDay で弾く。
    // ここでは勤務パターンの解決だけを行い、勤務行の有無を書き換えない
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-20",
        weeklyWorking,
        weeklyBusinessDay: weeklyClosed,
        businessDay: closed,
      }),
    ).toEqual(weeklyWorking);
  });

  it("定休曜日が開いていても実効営業時間に時刻が無ければ勤務扱いにしない", () => {
    // business_hours に時刻が無い定休曜日を、時刻なしの臨時営業で開けた場合。
    // 営業時間が定まらないので勤務時間も決められない
    expect(
      resolveStaffWorkingDay({
        date: "2026-07-20",
        weeklyWorking: null,
        weeklyBusinessDay: weeklyClosed,
        businessDay: { isOpen: true, openTime: null, closeTime: null },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. その日の実効営業時間を1引数の関数にする
// ---------------------------------------------------------------------------

describe("makeBusinessDayOf: その日の実効営業時間の関数化", () => {
  /** 月曜定休。他の曜日は 9:00〜21:00(business_hours の全行) */
  const weeklyBusinessHours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOpen: weekday !== 1,
    openTime: weekday === 1 ? null : "09:00:00",
    closeTime: weekday === 1 ? null : "21:00:00",
  }));
  const closed: BusinessDay = {
    isOpen: false,
    openTime: null,
    closeTime: null,
  };

  function businessDayOf(overrides: ClosureRules["overrides"] = []) {
    return makeBusinessDayOf({
      rules: rules({ businessHours: weeklyBusinessHours, overrides }),
      weeklyBusinessHours,
    });
  }

  it("その曜日の行を引いて resolveBusinessDay に渡す", () => {
    // 2026-07-18 は土曜(営業)
    expect(businessDayOf()("2026-07-18")).toEqual({
      isOpen: true,
      openTime: "09:00:00",
      closeTime: "21:00:00",
    });
    // 2026-07-20 は月曜(定休)
    expect(businessDayOf()("2026-07-20")).toEqual(closed);
  });

  it("行が無い曜日は休業扱いにする(business_hours の欠落に落ちない)", () => {
    const partial = weeklyBusinessHours.filter((row) => row.weekday !== 6);
    const resolve = makeBusinessDayOf({
      rules: rules({ businessHours: partial }),
      weeklyBusinessHours: partial,
    });
    expect(resolve("2026-07-18")).toEqual(closed);
  });

  it("時刻付きの臨時営業はその時刻を返す(定休曜日・短縮営業とも)", () => {
    const overrides = [
      {
        startDate: "2026-07-20", // 月曜(定休)
        endDate: "2026-07-20",
        isOpen: true,
        label: "臨時営業",
        openTime: "10:00:00",
        closeTime: "15:00:00",
      },
      {
        startDate: "2026-07-18", // 土曜(営業)の短縮
        endDate: "2026-07-18",
        isOpen: true,
        label: null,
        openTime: "09:00:00",
        closeTime: "15:00:00",
      },
    ];
    expect(businessDayOf(overrides)("2026-07-20")).toEqual({
      isOpen: true,
      openTime: "10:00:00",
      closeTime: "15:00:00",
    });
    expect(businessDayOf(overrides)("2026-07-18")).toEqual({
      isOpen: true,
      openTime: "09:00:00",
      closeTime: "15:00:00",
    });
  });

  describe("makeIsClosedDay との同値性(週表示が入力を1つに減らせるか)", () => {
    // 週表示は「定休日の表現(列全体)」に isClosedDay、「営業時間外の帯」に
    // businessDayOf を使う。両者が常に一致するなら入力を1つに減らせるので、
    // 推測せず代表的なルールで突き合わせる。
    const cases: Array<{
      name: string;
      date: string;
      overrides?: ClosureRules["overrides"];
    }> = [
      { name: "通常の営業日", date: "2026-07-18" },
      { name: "毎週の定休日(月曜)", date: "2026-07-20" },
      {
        name: "臨時休業",
        date: "2026-07-18",
        overrides: [
          {
            startDate: "2026-07-18",
            endDate: "2026-07-18",
            isOpen: false,
            label: "臨時休業",
            openTime: null,
            closeTime: null,
          },
        ],
      },
      {
        name: "定休曜日の時刻付き臨時営業",
        date: "2026-07-20",
        overrides: [
          {
            startDate: "2026-07-20",
            endDate: "2026-07-20",
            isOpen: true,
            label: null,
            openTime: "10:00:00",
            closeTime: "15:00:00",
          },
        ],
      },
      {
        name: "営業曜日の短縮営業",
        date: "2026-07-18",
        overrides: [
          {
            startDate: "2026-07-18",
            endDate: "2026-07-18",
            isOpen: true,
            label: null,
            openTime: "10:00:00",
            closeTime: "15:00:00",
          },
        ],
      },
      {
        name: "営業曜日の時刻なし臨時営業(祝日の打ち消し)",
        date: "2026-07-18",
        overrides: [
          {
            startDate: "2026-07-18",
            endDate: "2026-07-18",
            isOpen: true,
            label: null,
            openTime: null,
            closeTime: null,
          },
        ],
      },
    ];

    for (const testCase of cases) {
      it(`一致する: ${testCase.name}`, () => {
        const ruleSet = rules({
          businessHours: weeklyBusinessHours,
          overrides: testCase.overrides ?? [],
          nthWeekdayClosures: [{ weekday: 0, nth: 3 }],
          closeOnHolidays: true,
        });
        const isClosed = makeIsClosedDay(ruleSet)(testCase.date);
        const resolved = makeBusinessDayOf({
          rules: ruleSet,
          weeklyBusinessHours,
        })(testCase.date);
        expect(isClosed).toBe(!resolved.isOpen);
      });
    }

    it("一致しない: 定休曜日に時刻なしの臨時営業が掛かった日", () => {
      // 「休業ではない(上書きで開いている)が、営業時間が決まらない」状態。
      // validateDateOverride は新規登録を弾くが、登録後にその曜日を定休へ
      // 変えると残ってしまう。この1ケースがあるため、週表示は isClosedDay と
      // businessDayOf の両方を受け取る(入力を1つに減らさない)
      const ruleSet = rules({
        businessHours: weeklyBusinessHours,
        overrides: [
          {
            startDate: "2026-07-20", // 月曜(定休)
            endDate: "2026-07-20",
            isOpen: true,
            label: null,
            openTime: null,
            closeTime: null,
          },
        ],
      });
      expect(makeIsClosedDay(ruleSet)("2026-07-20")).toBe(false);
      expect(
        makeBusinessDayOf({ rules: ruleSet, weeklyBusinessHours })("2026-07-20")
          .isOpen,
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 9. business_hours から曜日の営業時間を引く(行が無い曜日は休業)
// ---------------------------------------------------------------------------

describe("weeklyBusinessDayOf: 曜日の営業時間(行が無い曜日は休業)", () => {
  /** 月曜定休。他の曜日は 9:00〜21:00(business_hours の全行) */
  const weeklyBusinessHours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOpen: weekday !== 1,
    openTime: weekday === 1 ? null : "09:00:00",
    closeTime: weekday === 1 ? null : "21:00:00",
  }));

  it("行がある営業曜日は、その行の営業時間を返す", () => {
    expect(weeklyBusinessDayOf(weeklyBusinessHours, 6)).toEqual({
      isOpen: true,
      openTime: "09:00:00",
      closeTime: "21:00:00",
    });
  });

  it("行がある定休曜日は、その行(isOpen:false)を返す", () => {
    expect(weeklyBusinessDayOf(weeklyBusinessHours, 1)).toEqual({
      isOpen: false,
      openTime: null,
      closeTime: null,
    });
  });

  it("行が無い曜日は休業({ isOpen:false, 時刻なし })を返す", () => {
    const partial = weeklyBusinessHours.filter((row) => row.weekday !== 6);
    expect(weeklyBusinessDayOf(partial, 6)).toEqual({
      isOpen: false,
      openTime: null,
      closeTime: null,
    });
    expect(weeklyBusinessDayOf([], 0)).toEqual({
      isOpen: false,
      openTime: null,
      closeTime: null,
    });
  });

  it("weekday などの余分な項目は返さない(BusinessDay の3項目だけ)", () => {
    const withExtra = [{ ...weeklyBusinessHours[6], note: "余分な項目" }];
    expect(Object.keys(weeklyBusinessDayOf(withExtra, 6)).sort()).toEqual([
      "closeTime",
      "isOpen",
      "openTime",
    ]);
  });

  it("戻り値を書き換えても元の行は変わらない(行そのものを返さない)", () => {
    const rows = [{ ...weeklyBusinessHours[6] }];
    const day = weeklyBusinessDayOf(rows, 6);
    day.openTime = "10:00:00";
    expect(rows[0].openTime).toBe("09:00:00");
  });
});

describe("closedWeekdaysOf: 毎週の定休曜日の一覧", () => {
  it("isOpen が false の曜日を昇順で返す", () => {
    const hours = [6, 3, 0, 1, 2, 4, 5].map((weekday) => ({
      weekday,
      isOpen: weekday !== 1 && weekday !== 3,
      openTime: weekday === 1 || weekday === 3 ? null : "09:00:00",
      closeTime: weekday === 1 || weekday === 3 ? null : "21:00:00",
    }));
    expect(closedWeekdaysOf(hours)).toEqual([1, 3]);
  });

  it("行が無い曜日も定休曜日に含める", () => {
    const hours = [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      isOpen: true,
      openTime: "09:00:00",
      closeTime: "21:00:00",
    }));
    expect(closedWeekdaysOf(hours)).toEqual([0, 6]);
  });

  it("全曜日が営業なら空配列を返す", () => {
    const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: true,
      openTime: "09:00:00",
      closeTime: "21:00:00",
    }));
    expect(closedWeekdaysOf(hours)).toEqual([]);
  });

  it("行が1つも無ければ全曜日(0〜6)を返す", () => {
    expect(closedWeekdaysOf([])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
