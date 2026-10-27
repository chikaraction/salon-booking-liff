import { describe, expect, it } from "vitest";

import {
  DATE_OVERRIDE_OVERLAP_MESSAGE,
  changedNthWeekdayWeekdays,
  changedWeeklyHourWeekdays,
  closureListWindow,
  describeNthWeekdayClosures,
  diffNthWeekdayClosures,
  fillWeeklyBusinessHours,
  findOverlappingOverride,
  flattenNthWeekdayGroups,
  groupNthWeekdayClosures,
  isDateRangeOverlapError,
  validateDateOverride,
  validateWeeklyBusinessHours,
  weekdayLongLabel,
  weekdayShortLabel,
  weekdaysInRange,
  type DateOverrideInput,
  type WeeklyHoursInput,
} from "./business-settings";

// ---------------------------------------------------------------------------
// 1. 曜日ラベル
// ---------------------------------------------------------------------------

describe("weekdayShortLabel / weekdayLongLabel", () => {
  it("0=日曜〜6=土曜の順でラベルを返す", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(weekdayShortLabel)).toEqual([
      "日",
      "月",
      "火",
      "水",
      "木",
      "金",
      "土",
    ]);
    expect(weekdayLongLabel(0)).toBe("日曜日");
    expect(weekdayLongLabel(3)).toBe("水曜日");
  });
});

// ---------------------------------------------------------------------------
// 2. 曜日ごとの営業時間
// ---------------------------------------------------------------------------

/** 全曜日を同じ営業時間で埋めた入力(必要な曜日だけ上書きして使う) */
function weeklyInput(
  overrides: Partial<Record<number, Partial<WeeklyHoursInput>>> = {},
): WeeklyHoursInput[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOpen: true,
    openTime: "10:00",
    closeTime: "19:00",
    ...overrides[weekday],
  }));
}

describe("fillWeeklyBusinessHours", () => {
  it("行が無い曜日を「休業・時刻なし」で補って日曜〜土曜の7件にする", () => {
    const filled = fillWeeklyBusinessHours([
      { weekday: 2, isOpen: true, openTime: "10:00:00", closeTime: "19:00:00" },
    ]);
    expect(filled).toHaveLength(7);
    expect(filled[2]).toEqual({
      weekday: 2,
      isOpen: true,
      openTime: "10:00:00",
      closeTime: "19:00:00",
    });
    expect(filled[0]).toEqual({
      weekday: 0,
      isOpen: false,
      openTime: null,
      closeTime: null,
    });
  });

  it("曜日順に並べ替える(DBの並びに依存しない)", () => {
    const filled = fillWeeklyBusinessHours([
      { weekday: 5, isOpen: true, openTime: "10:00", closeTime: "19:00" },
      { weekday: 1, isOpen: false, openTime: null, closeTime: null },
    ]);
    expect(filled.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("validateWeeklyBusinessHours", () => {
  it("営業する曜日に開店・閉店が揃っていれば通り、時刻をそのまま返す", () => {
    const result = validateWeeklyBusinessHours(weeklyInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[3]).toEqual({
      weekday: 3,
      isOpen: true,
      openTime: "10:00",
      closeTime: "19:00",
    });
  });

  it("休業の曜日は時刻を捨ててnullにする(DB制約 date_overrides と同じく矛盾を持ち込まない)", () => {
    const result = validateWeeklyBusinessHours(
      weeklyInput({ 3: { isOpen: false } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[3]).toEqual({
      weekday: 3,
      isOpen: false,
      openTime: null,
      closeTime: null,
    });
  });

  it("営業する曜日に時刻が無ければ、その曜日にエラーを出す(business_hours_times_required)", () => {
    const result = validateWeeklyBusinessHours(
      weeklyInput({ 1: { openTime: "" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[1]).toBe("開店・閉店の時刻を入力してください");
    expect(result.errors[2]).toBeUndefined();
  });

  it("時刻の形式が不正ならエラーにする", () => {
    const result = validateWeeklyBusinessHours(
      weeklyInput({ 4: { closeTime: "25:00" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[4]).toBe("開店・閉店の時刻を入力してください");
  });

  it("開店 >= 閉店ならエラーにする", () => {
    const result = validateWeeklyBusinessHours(
      weeklyInput({ 6: { openTime: "19:00", closeTime: "19:00" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[6]).toBe("開店時刻は閉店時刻より前にしてください");
  });

  it("休業の曜日は時刻が空でもエラーにしない", () => {
    const result = validateWeeklyBusinessHours(
      weeklyInput({ 3: { isOpen: false, openTime: "", closeTime: "" } }),
    );
    expect(result.ok).toBe(true);
  });

  it("曜日が0〜6でない・重複しているなど7曜日が揃っていなければ拒否する", () => {
    const result = validateWeeklyBusinessHours(weeklyInput().slice(0, 6));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("営業時間の入力が正しくありません");
  });
});

// ---------------------------------------------------------------------------
// 3. 第◯曜日の定休(UI形 ⇔ DB行集合)
// ---------------------------------------------------------------------------

describe("groupNthWeekdayClosures", () => {
  it("(曜日, 第◯)の行集合を曜日ごとのブロックに畳む", () => {
    expect(
      groupNthWeekdayClosures([
        { weekday: 0, nth: 3 },
        { weekday: 0, nth: 1 },
        { weekday: 3, nth: 2 },
      ]),
    ).toEqual([
      { weekday: 0, nths: [1, 3] },
      { weekday: 3, nths: [2] },
    ]);
  });

  it("行が無ければ空配列を返す", () => {
    expect(groupNthWeekdayClosures([])).toEqual([]);
  });
});

describe("flattenNthWeekdayGroups", () => {
  it("曜日ごとのブロックを(曜日, 第◯)の行集合に展開する", () => {
    expect(
      flattenNthWeekdayGroups([
        { weekday: 3, nths: [2] },
        { weekday: 0, nths: [3, 1] },
      ]),
    ).toEqual([
      { weekday: 0, nth: 1 },
      { weekday: 0, nth: 3 },
      { weekday: 3, nth: 2 },
    ]);
  });

  it("第◯を1つも選んでいないブロックは行にしない(追加しただけの空行を捨てる)", () => {
    expect(flattenNthWeekdayGroups([{ weekday: 5, nths: [] }])).toEqual([]);
  });

  it("同じ曜日のブロックが2つあっても(曜日, 第◯)は重複させない(unique制約)", () => {
    expect(
      flattenNthWeekdayGroups([
        { weekday: 0, nths: [1, 3] },
        { weekday: 0, nths: [3] },
      ]),
    ).toEqual([
      { weekday: 0, nth: 1 },
      { weekday: 0, nth: 3 },
    ]);
  });

  it("畳んでから展開すると元の行集合に戻る", () => {
    const rows = [
      { weekday: 0, nth: 1 },
      { weekday: 0, nth: 3 },
      { weekday: 3, nth: 2 },
    ];
    expect(flattenNthWeekdayGroups(groupNthWeekdayClosures(rows))).toEqual(
      rows,
    );
  });
});

describe("diffNthWeekdayClosures", () => {
  it("現在も希望も空なら何もしない", () => {
    expect(diffNthWeekdayClosures({ current: [], desired: [] })).toEqual({
      inserts: [],
      deleteIds: [],
    });
  });

  it("現在と希望が同じ集合なら何もしない", () => {
    expect(
      diffNthWeekdayClosures({
        current: [
          { id: "a", weekday: 0, nth: 3 },
          { id: "b", weekday: 3, nth: 2 },
        ],
        desired: [
          { weekday: 0, nth: 3 },
          { weekday: 3, nth: 2 },
        ],
      }),
    ).toEqual({ inserts: [], deleteIds: [] });
  });

  it("希望にだけある行を追加する", () => {
    expect(
      diffNthWeekdayClosures({
        current: [{ id: "a", weekday: 0, nth: 3 }],
        desired: [
          { weekday: 0, nth: 3 },
          { weekday: 0, nth: 1 },
        ],
      }),
    ).toEqual({ inserts: [{ weekday: 0, nth: 1 }], deleteIds: [] });
  });

  it("現在にだけある行を削除する(希望が空なら全件削除)", () => {
    expect(
      diffNthWeekdayClosures({
        current: [
          { id: "a", weekday: 0, nth: 3 },
          { id: "b", weekday: 3, nth: 2 },
        ],
        desired: [],
      }),
    ).toEqual({ inserts: [], deleteIds: ["a", "b"] });
  });

  it("追加と削除が混在しても、共通の行には触らない", () => {
    expect(
      diffNthWeekdayClosures({
        current: [
          { id: "a", weekday: 0, nth: 3 },
          { id: "b", weekday: 3, nth: 2 },
        ],
        desired: [
          { weekday: 0, nth: 3 },
          { weekday: 6, nth: 5 },
        ],
      }),
    ).toEqual({ inserts: [{ weekday: 6, nth: 5 }], deleteIds: ["b"] });
  });

  it("曜日が同じでも第◯が違えば別の行として扱う", () => {
    expect(
      diffNthWeekdayClosures({
        current: [{ id: "a", weekday: 0, nth: 3 }],
        desired: [{ weekday: 0, nth: 4 }],
      }),
    ).toEqual({ inserts: [{ weekday: 0, nth: 4 }], deleteIds: ["a"] });
  });

  it("希望に重複があっても追加は1件にする(unique制約)", () => {
    expect(
      diffNthWeekdayClosures({
        current: [],
        desired: [
          { weekday: 0, nth: 1 },
          { weekday: 0, nth: 1 },
        ],
      }),
    ).toEqual({ inserts: [{ weekday: 0, nth: 1 }], deleteIds: [] });
  });

  it("並び順に左右されず、追加・削除とも曜日→第◯の昇順で返す", () => {
    const expected = {
      inserts: [
        { weekday: 1, nth: 2 },
        { weekday: 1, nth: 4 },
        { weekday: 5, nth: 1 },
      ],
      deleteIds: ["sun-3", "wed-1", "wed-2"],
    };
    const current = [
      { id: "wed-2", weekday: 3, nth: 2 },
      { id: "keep", weekday: 6, nth: 5 },
      { id: "sun-3", weekday: 0, nth: 3 },
      { id: "wed-1", weekday: 3, nth: 1 },
    ];
    const desired = [
      { weekday: 5, nth: 1 },
      { weekday: 6, nth: 5 },
      { weekday: 1, nth: 4 },
      { weekday: 1, nth: 2 },
    ];
    expect(diffNthWeekdayClosures({ current, desired })).toEqual(expected);
    expect(
      diffNthWeekdayClosures({
        current: [...current].reverse(),
        desired: [...desired].reverse(),
      }),
    ).toEqual(expected);
  });
});

describe("describeNthWeekdayClosures", () => {
  it("1件ならモックの文言どおりに整形する", () => {
    expect(describeNthWeekdayClosures([{ weekday: 0, nth: 3 }])).toBe(
      "毎月 第3日曜日 を定休に設定中。カレンダーの該当日は自動で休業になります。",
    );
  });

  it("同じ曜日の複数の週は「第1・第3日曜日」とまとめる", () => {
    expect(
      describeNthWeekdayClosures([
        { weekday: 0, nth: 3 },
        { weekday: 0, nth: 1 },
      ]),
    ).toBe(
      "毎月 第1・第3日曜日 を定休に設定中。カレンダーの該当日は自動で休業になります。",
    );
  });

  it("曜日が複数あれば読点でつなぐ", () => {
    expect(
      describeNthWeekdayClosures([
        { weekday: 0, nth: 1 },
        { weekday: 3, nth: 2 },
      ]),
    ).toBe(
      "毎月 第1日曜日、第2水曜日 を定休に設定中。カレンダーの該当日は自動で休業になります。",
    );
  });

  it("未登録なら null(補足文そのものを出さない)", () => {
    expect(describeNthWeekdayClosures([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. 臨時休業・臨時営業(date_overrides)の入力検証
// ---------------------------------------------------------------------------

/** 単日の休業(必要な項目だけ上書きして使う) */
function overrideInput(
  patch: Partial<DateOverrideInput> = {},
): DateOverrideInput {
  return {
    startDate: "2026-07-29",
    endDate: "2026-07-29",
    isOpen: false,
    label: "",
    openTime: "",
    closeTime: "",
    ...patch,
  };
}

describe("weekdaysInRange", () => {
  it("単日はその曜日だけを返す(2026-07-29は水曜)", () => {
    expect(weekdaysInRange("2026-07-29", "2026-07-29")).toEqual([3]);
  });

  it("複数日は含まれる曜日を昇順で返す", () => {
    // 2026-08-13(木)〜16(日)
    expect(weekdaysInRange("2026-08-13", "2026-08-16")).toEqual([0, 4, 5, 6]);
  });

  it("7日以上の期間は全曜日を含む(長い期間でも走査は7日で打ち切る)", () => {
    expect(weekdaysInRange("2026-08-01", "2026-12-31")).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe("validateDateOverride", () => {
  it("単日の休業は時刻なしで通る", () => {
    const result = validateDateOverride({
      input: overrideInput({ label: "臨時休業" }),
      closedWeekdays: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      startDate: "2026-07-29",
      endDate: "2026-07-29",
      isOpen: false,
      label: "臨時休業",
      openTime: null,
      closeTime: null,
    });
  });

  it("ラベル未入力は null にする(前後の空白は落とす)", () => {
    const result = validateDateOverride({
      input: overrideInput({ label: "  " }),
      closedWeekdays: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBeNull();
  });

  it("休業に時刻が入っていても捨てる(date_overrides_closed_has_no_times)", () => {
    const result = validateDateOverride({
      input: overrideInput({ openTime: "10:00", closeTime: "19:00" }),
      closedWeekdays: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.openTime).toBeNull();
    expect(result.value.closeTime).toBeNull();
  });

  it("日付が未入力・不正ならエラーにする", () => {
    const result = validateDateOverride({
      input: overrideInput({ startDate: "", endDate: "2026-13-01" }),
      closedWeekdays: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.startDate).toBe("開始日を選択してください");
    expect(result.errors.endDate).toBe("終了日を選択してください");
  });

  it("開始 > 終了ならエラーにする(date_overrides_range)", () => {
    const result = validateDateOverride({
      input: overrideInput({
        startDate: "2026-08-16",
        endDate: "2026-08-13",
      }),
      closedWeekdays: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.endDate).toBe("終了日は開始日以降にしてください");
  });

  it("臨時営業は時刻なしでも通る(定休曜日を含まない場合はその曜日の営業時間に従う)", () => {
    const result = validateDateOverride({
      // 2026-07-20は月曜。定休曜日は水曜だけ
      input: overrideInput({
        startDate: "2026-07-20",
        endDate: "2026-07-20",
        isOpen: true,
      }),
      closedWeekdays: [3],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.openTime).toBeNull();
  });

  it("臨時営業の時刻は開店・閉店のペアで入力させる(date_overrides_times_pair)", () => {
    const result = validateDateOverride({
      input: overrideInput({
        startDate: "2026-07-20",
        endDate: "2026-07-20",
        isOpen: true,
        openTime: "10:00",
      }),
      closedWeekdays: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.time).toBe("開店・閉店の両方を入力してください");
  });

  it("臨時営業の開店 >= 閉店はエラーにする(date_overrides_times_valid)", () => {
    const result = validateDateOverride({
      input: overrideInput({
        startDate: "2026-07-20",
        endDate: "2026-07-20",
        isOpen: true,
        openTime: "19:00",
        closeTime: "10:00",
      }),
      closedWeekdays: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.time).toBe("開店時刻は閉店時刻より前にしてください");
  });

  it("臨時営業の期間に毎週の定休曜日が含まれるなら営業時間を必須にする", () => {
    // 2026-07-29は水曜 = 定休曜日。時刻が無いと business_hours にも時刻が無く
    // 営業日として開いても客側の枠が1つも出ない(closures.ts の resolveBusinessDay)
    const result = validateDateOverride({
      input: overrideInput({ isOpen: true }),
      closedWeekdays: [3],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.time).toBe(
      "定休の曜日を臨時営業にするときは営業時間の入力が必要です",
    );
  });

  it("定休曜日を含む臨時営業でも時刻を入れれば通る", () => {
    const result = validateDateOverride({
      input: overrideInput({
        isOpen: true,
        openTime: "10:00",
        closeTime: "15:00",
      }),
      closedWeekdays: [3],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.openTime).toBe("10:00");
    expect(result.value.closeTime).toBe("15:00");
  });

  it("連休の途中に定休曜日が入る場合も営業時間を必須にする", () => {
    const result = validateDateOverride({
      // 2026-08-13(木)〜16(日)に日曜が含まれる
      input: overrideInput({
        startDate: "2026-08-13",
        endDate: "2026-08-16",
        isOpen: true,
      }),
      closedWeekdays: [0],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.time).toBe(
      "定休の曜日を臨時営業にするときは営業時間の入力が必要です",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. 既存の登録期間との重なり(事前チェック。最後の砦はDBのEXCLUDE制約)
// ---------------------------------------------------------------------------

describe("findOverlappingOverride", () => {
  const existing = [
    { id: "a", startDate: "2026-08-13", endDate: "2026-08-16" },
    { id: "b", startDate: "2026-07-29", endDate: "2026-07-29" },
  ];

  it("重ならなければ null", () => {
    expect(
      findOverlappingOverride(
        { startDate: "2026-08-17", endDate: "2026-08-18" },
        existing,
      ),
    ).toBeNull();
  });

  it("期間が一部でも重なれば、その行を返す", () => {
    expect(
      findOverlappingOverride(
        { startDate: "2026-08-16", endDate: "2026-08-20" },
        existing,
      )?.id,
    ).toBe("a");
  });

  it("既存の期間を丸ごと含む場合も重なりとみなす", () => {
    expect(
      findOverlappingOverride(
        { startDate: "2026-08-01", endDate: "2026-08-31" },
        existing,
      )?.id,
    ).toBe("a");
  });

  it("既存の期間の内側に収まる場合も重なりとみなす", () => {
    expect(
      findOverlappingOverride(
        { startDate: "2026-08-14", endDate: "2026-08-15" },
        existing,
      )?.id,
    ).toBe("a");
  });

  it("同じ単日の登録も重なりとみなす", () => {
    expect(
      findOverlappingOverride(
        { startDate: "2026-07-29", endDate: "2026-07-29" },
        existing,
      )?.id,
    ).toBe("b");
  });
});

describe("isDateRangeOverlapError", () => {
  it("EXCLUDE制約違反(23P01)を、期間の重なりとして判定する", () => {
    expect(isDateRangeOverlapError({ code: "23P01" })).toBe(true);
    expect(isDateRangeOverlapError({ code: "23505" })).toBe(false);
  });
});

describe("DATE_OVERRIDE_OVERLAP_MESSAGE", () => {
  it("事前チェックと23P01の変換で同じ文言を使う", () => {
    expect(DATE_OVERRIDE_OVERLAP_MESSAGE).toBe(
      "その期間はすでに登録されています",
    );
  });
});

// ---------------------------------------------------------------------------
// 6. 臨時休業・指定日リストの表示期間
// ---------------------------------------------------------------------------

describe("closureListWindow", () => {
  it("既定は今日から180日ぶん", () => {
    expect(closureListWindow({ today: "2026-07-18", overrides: [] })).toEqual({
      from: "2026-07-18",
      days: 180,
    });
  });

  it("既定の期間より先の登録があれば、その終了日まで期間を伸ばす(登録した行が必ず一覧に出る)", () => {
    const window = closureListWindow({
      today: "2026-07-18",
      overrides: [{ startDate: "2027-05-30", endDate: "2027-06-01" }],
    });
    expect(window.from).toBe("2026-07-18");
    // 2026-07-18 から 2027-06-01 まで(両端を含む)
    expect(window.days).toBe(319);
  });

  it("過去に終わった登録では期間を伸ばさない(一覧は今後の休業予定)", () => {
    expect(
      closureListWindow({
        today: "2026-07-18",
        overrides: [{ startDate: "2026-01-01", endDate: "2026-01-03" }],
      }),
    ).toEqual({ from: "2026-07-18", days: 180 });
  });
});

// ---------------------------------------------------------------------------
// 7. 未保存の変更の判定(節ごとの保存ボタン・「元に戻す」・変更箇所の目印)
// ---------------------------------------------------------------------------

describe("changedWeeklyHourWeekdays", () => {
  it("時刻を変えた曜日だけを返す", () => {
    expect(
      changedWeeklyHourWeekdays(
        weeklyInput(),
        weeklyInput({ 3: { closeTime: "21:00" } }),
      ),
    ).toEqual([3]);
  });

  it("定休と営業の切り替えも変更として返す", () => {
    expect(
      changedWeeklyHourWeekdays(
        weeklyInput(),
        weeklyInput({ 1: { isOpen: false } }),
      ),
    ).toEqual([1]);
  });

  it("変更した曜日が複数あれば曜日順に返す", () => {
    expect(
      changedWeeklyHourWeekdays(
        weeklyInput(),
        weeklyInput({ 5: { openTime: "11:00" }, 2: { isOpen: false } }),
      ),
    ).toEqual([2, 5]);
  });

  it("「09:00」と「9:00」・前後の空白は同じ時刻として扱う", () => {
    expect(
      changedWeeklyHourWeekdays(
        weeklyInput({ 4: { openTime: "09:00" } }),
        weeklyInput({ 4: { openTime: " 9:00 " } }),
      ),
    ).toEqual([]);
  });

  it("DBの秒付きの値と input[type=time] の HH:MM は同じ時刻として扱う", () => {
    expect(
      changedWeeklyHourWeekdays(
        weeklyInput({ 4: { openTime: "10:00:00" } }),
        weeklyInput({ 4: { openTime: "10:00" } }),
      ),
    ).toEqual([]);
  });

  it("休業の曜日に残った時刻は変更として扱わない(保存時に捨てられるため)", () => {
    expect(
      changedWeeklyHourWeekdays(
        weeklyInput({ 0: { isOpen: false, openTime: "", closeTime: "" } }),
        weeklyInput({
          0: { isOpen: false, openTime: "10:00", closeTime: "19:00" },
        }),
      ),
    ).toEqual([]);
  });
});

describe("changedNthWeekdayWeekdays", () => {
  it("保存済みの行と同じ内容なら変更なし", () => {
    const saved = [
      { weekday: 0, nth: 1 },
      { weekday: 0, nth: 3 },
    ];
    expect(
      changedNthWeekdayWeekdays(saved, [{ weekday: 0, nths: [1, 3] }]),
    ).toEqual([]);
  });

  it("第◯を増やした曜日を返す", () => {
    expect(
      changedNthWeekdayWeekdays(
        [{ weekday: 0, nth: 1 }],
        [{ weekday: 0, nths: [1, 3] }],
      ),
    ).toEqual([0]);
  });

  it("ブロックを消した曜日を返す", () => {
    expect(changedNthWeekdayWeekdays([{ weekday: 2, nth: 4 }], [])).toEqual([
      2,
    ]);
  });

  it("曜日を変えたら元の曜日と新しい曜日の両方を返す", () => {
    expect(
      changedNthWeekdayWeekdays(
        [{ weekday: 0, nth: 1 }],
        [{ weekday: 3, nths: [1] }],
      ),
    ).toEqual([0, 3]);
  });

  it("第◯を1つも選んでいない空のブロックは変更として扱わない(保存時に落ちるため)", () => {
    expect(changedNthWeekdayWeekdays([], [{ weekday: 0, nths: [] }])).toEqual(
      [],
    );
  });

  it("同じ曜日が2ブロックに分かれていても、合わせた内容が同じなら変更なし", () => {
    const saved = [
      { weekday: 0, nth: 1 },
      { weekday: 0, nth: 3 },
    ];
    expect(
      changedNthWeekdayWeekdays(saved, [
        { weekday: 0, nths: [3] },
        { weekday: 0, nths: [1, 3] },
      ]),
    ).toEqual([]);
  });

  it("第◯の並び順の違いは変更として扱わない", () => {
    expect(
      changedNthWeekdayWeekdays(
        [
          { weekday: 1, nth: 2 },
          { weekday: 1, nth: 4 },
        ],
        [{ weekday: 1, nths: [4, 2] }],
      ),
    ).toEqual([]);
  });
});
