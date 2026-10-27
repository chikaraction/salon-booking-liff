import { describe, expect, it } from "vitest";

import { jstDateTime } from "./jst";
import {
  BLOCK_NO_WORKING_DAY_MESSAGE,
  LAST_OWNER_MESSAGE,
  STAFF_INVALID_MESSAGE,
  WORKING_HOURS_INVALID_MESSAGE,
  applyTimesToWorkingDays,
  changedStaffFields,
  changedWorkingDayWeekdays,
  describeStaffBlocks,
  describeStaffLogin,
  diffStaffWorkingHours,
  fillStaffWorkingHours,
  findLastOwnerViolation,
  isBlockConflictError,
  resolveStaffBlockRange,
  staffBlockLabel,
  staffHeadingLabel,
  staffRoleLabel,
  validateStaffInput,
  validateStaffWorkingHours,
  type StaffInput,
  type WorkingDayInput,
} from "./staff-settings";

// ---------------------------------------------------------------------------
// 1. スタッフの表示ラベル(モックEの見出し「田中(オーナー)」)
// ---------------------------------------------------------------------------

describe("staffRoleLabel / staffHeadingLabel", () => {
  it("ロールを日本語のラベルにする", () => {
    expect(staffRoleLabel("owner")).toBe("オーナー");
    expect(staffRoleLabel("staff")).toBe("スタッフ");
  });

  it("見出しを「名前(ロール)」形式にする", () => {
    expect(staffHeadingLabel({ name: "田中", role: "owner" })).toBe(
      "田中(オーナー)",
    );
    expect(staffHeadingLabel({ name: "佐藤", role: "staff" })).toBe(
      "佐藤(スタッフ)",
    );
  });
});

describe("describeStaffLogin", () => {
  it("既存スタッフは名前を出して、ログインできることを伝える", () => {
    expect(describeStaffLogin({ name: "田中", hasAuthUser: true })).toEqual({
      status: "田中さんは管理画面にログインできます。",
      action: null,
    });
  });

  it("ログインできる既存スタッフには依頼の案内を出さない(もう必要ないため)", () => {
    expect(
      describeStaffLogin({ name: "田中", hasAuthUser: true }).action,
    ).toBeNull();
  });

  it("ログインできない既存スタッフは、名前と依頼先を伝える", () => {
    expect(describeStaffLogin({ name: "佐藤", hasAuthUser: false })).toEqual({
      status: "佐藤さんは管理画面にログインできません。",
      action:
        "管理画面にログインさせたい場合は、システムの管理担当者に依頼してください。",
    });
  });

  it("新規追加(まだ名前が決まっていない)は、これから追加するスタッフについて述べる", () => {
    const note = describeStaffLogin(null);
    expect(note.status).toBe(
      "ここで追加したスタッフは、管理画面にログインできません。",
    );
    expect(note.action).toBe(
      "管理画面にログインさせたい場合は、システムの管理担当者に依頼してください。",
    );
  });

  it("名前の前後の空白は落とす(入力欄と同じ正規化)", () => {
    expect(describeStaffLogin({ name: " 田中 ", hasAuthUser: true })).toEqual({
      status: "田中さんは管理画面にログインできます。",
      action: null,
    });
  });

  it("名前に敬称が入っていれば「さん」を重ねない", () => {
    expect(describeStaffLogin({ name: "田中さん", hasAuthUser: true })).toEqual(
      {
        status: "田中さんは管理画面にログインできます。",
        action: null,
      },
    );
    expect(describeStaffLogin({ name: "田中様", hasAuthUser: true })).toEqual({
      status: "田中様は管理画面にログインできます。",
      action: null,
    });
  });

  it("名前が空でも文が壊れない(名前の代わりに選択中のスタッフを指す)", () => {
    expect(describeStaffLogin({ name: "  ", hasAuthUser: false })).toEqual({
      status: "いま選んでいるスタッフは管理画面にログインできません。",
      action:
        "管理画面にログインさせたい場合は、システムの管理担当者に依頼してください。",
    });
  });
});

// ---------------------------------------------------------------------------
// 2. スタッフ行のバリデーション
// ---------------------------------------------------------------------------

function staffInput(patch: Partial<StaffInput> = {}): StaffInput {
  return {
    name: "田中",
    role: "staff",
    displayOrder: "1",
    isActive: true,
    bio: "",
    ...patch,
  };
}

describe("validateStaffInput", () => {
  it("正しい入力はそのまま保存できる値になる", () => {
    const result = validateStaffInput(
      staffInput({ role: "owner", displayOrder: "3", bio: " カット担当 " }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        name: "田中",
        role: "owner",
        displayOrder: 3,
        isActive: true,
        bio: "カット担当",
      },
    });
  });

  it("名前の前後の空白は落とし、空欄はエラーにする", () => {
    const trimmed = validateStaffInput(staffInput({ name: "  田中  " }));
    expect(trimmed.ok && trimmed.value.name).toBe("田中");

    const empty = validateStaffInput(staffInput({ name: "   " }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.errors.name).toBe("名前を入力してください");
      expect(empty.message).toBe(STAFF_INVALID_MESSAGE);
    }
  });

  it("自己紹介が空文字ならNULLにする(空文字と未入力を区別しない)", () => {
    const result = validateStaffInput(staffInput({ bio: "  " }));
    expect(result.ok && result.value.bio).toBeNull();
  });

  it("ロールは owner / staff 以外を受け付けない", () => {
    const result = validateStaffInput(staffInput({ role: "admin" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.role).toBe("ロールの指定が正しくありません");
    }
  });

  it("表示順は0以上の整数のみ受け付ける", () => {
    for (const displayOrder of ["", "-1", "1.5", "あ"]) {
      const result = validateStaffInput(staffInput({ displayOrder }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.displayOrder).toBe(
          "表示順は0以上の整数で入力してください",
        );
      }
    }
    const zero = validateStaffInput(staffInput({ displayOrder: "0" }));
    expect(zero.ok && zero.value.displayOrder).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. 最後のオーナーを降格・無効化できない
// ---------------------------------------------------------------------------

describe("findLastOwnerViolation", () => {
  const staffList = [
    { id: "owner-1", role: "owner" as const, isActive: true },
    { id: "staff-1", role: "staff" as const, isActive: true },
  ];

  it("最後のオーナーをスタッフに降格させようとすると拒否する", () => {
    expect(
      findLastOwnerViolation({
        staffList,
        target: { id: "owner-1", role: "staff", isActive: true },
      }),
    ).toBe(LAST_OWNER_MESSAGE);
  });

  it("最後のオーナーを無効にしようとすると拒否する", () => {
    expect(
      findLastOwnerViolation({
        staffList,
        target: { id: "owner-1", role: "owner", isActive: false },
      }),
    ).toBe(LAST_OWNER_MESSAGE);
  });

  it("オーナーが他にもいれば降格・無効化できる", () => {
    const twoOwners = [
      ...staffList,
      { id: "owner-2", role: "owner" as const, isActive: true },
    ];
    expect(
      findLastOwnerViolation({
        staffList: twoOwners,
        target: { id: "owner-1", role: "staff", isActive: true },
      }),
    ).toBeNull();
  });

  it("無効なオーナーは頭数に入れない(設定を変更できないため)", () => {
    const withInactiveOwner = [
      { id: "owner-1", role: "owner" as const, isActive: true },
      { id: "owner-2", role: "owner" as const, isActive: false },
    ];
    expect(
      findLastOwnerViolation({
        staffList: withInactiveOwner,
        target: { id: "owner-1", role: "staff", isActive: true },
      }),
    ).toBe(LAST_OWNER_MESSAGE);
  });

  it("オーナー以外の変更・新規追加は妨げない", () => {
    expect(
      findLastOwnerViolation({
        staffList,
        target: { id: "staff-1", role: "staff", isActive: false },
      }),
    ).toBeNull();
    expect(
      findLastOwnerViolation({
        staffList,
        target: { id: null, role: "staff", isActive: true },
      }),
    ).toBeNull();
  });

  it("オーナーへの昇格はオーナーを減らさないので妨げない", () => {
    expect(
      findLastOwnerViolation({
        staffList,
        target: { id: "staff-1", role: "owner", isActive: true },
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. 週次勤務パターン(staff_working_hours)
// ---------------------------------------------------------------------------

function workingDay(patch: Partial<WorkingDayInput> = {}): WorkingDayInput {
  return {
    weekday: 1,
    isWorking: true,
    startTime: "09:00",
    endTime: "19:00",
    breakStart: "",
    breakEnd: "",
    ...patch,
  };
}

/** 日曜〜土曜の7件を作る(既定は全曜日OFF) */
function allWeekdays(
  patches: Record<number, Partial<WorkingDayInput>> = {},
): WorkingDayInput[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
    workingDay({ weekday, isWorking: false, ...(patches[weekday] ?? {}) }),
  );
}

describe("fillStaffWorkingHours", () => {
  it("行が無い曜日はOFF(勤務日でない)で7件に揃える", () => {
    const filled = fillStaffWorkingHours([
      {
        weekday: 3,
        startTime: "10:00:00",
        endTime: "18:00:00",
        breakStart: "13:00:00",
        breakEnd: "14:00:00",
      },
    ]);
    expect(filled).toHaveLength(7);
    expect(filled.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(filled[3]).toEqual({
      weekday: 3,
      isWorking: true,
      startTime: "10:00",
      endTime: "18:00",
      breakStart: "13:00",
      breakEnd: "14:00",
    });
    expect(filled[0]).toEqual({
      weekday: 0,
      isWorking: false,
      startTime: "",
      endTime: "",
      breakStart: "",
      breakEnd: "",
    });
  });
});

describe("validateStaffWorkingHours", () => {
  it("勤務日だけを検証済みの値にする(休みの曜日は値にしない)", () => {
    const result = validateStaffWorkingHours(
      allWeekdays({
        1: { isWorking: true, startTime: "09:00", endTime: "19:00" },
        2: {
          isWorking: true,
          startTime: "10:00",
          endTime: "18:00",
          breakStart: "13:00",
          breakEnd: "14:00",
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: [
        {
          weekday: 1,
          startTime: "09:00",
          endTime: "19:00",
          breakStart: null,
          breakEnd: null,
        },
        {
          weekday: 2,
          startTime: "10:00",
          endTime: "18:00",
          breakStart: "13:00",
          breakEnd: "14:00",
        },
      ],
    });
  });

  it("勤務日は開始・終了が必須(staff_working_hours の NOT NULL と同じ)", () => {
    const result = validateStaffWorkingHours(
      allWeekdays({ 1: { isWorking: true, startTime: "", endTime: "19:00" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[1]).toBe("開始・終了の時刻を入力してください");
      expect(result.message).toBe(WORKING_HOURS_INVALID_MESSAGE);
    }
  });

  it("開始 < 終了 でなければエラー(staff_working_hours_valid_range)", () => {
    const result = validateStaffWorkingHours(
      allWeekdays({
        1: { isWorking: true, startTime: "19:00", endTime: "09:00" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[1]).toBe("開始時刻は終了時刻より前にしてください");
    }
  });

  it("休憩は開始・終了のペアでなければエラー(staff_working_hours_break_pair)", () => {
    const result = validateStaffWorkingHours(
      allWeekdays({ 1: { isWorking: true, breakStart: "13:00" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[1]).toBe(
        "休憩は開始・終了の両方を入力してください(休憩なしは両方空欄)",
      );
    }
  });

  it("休憩の開始 < 終了 でなければエラー(staff_working_hours_break_within)", () => {
    const result = validateStaffWorkingHours(
      allWeekdays({
        1: { isWorking: true, breakStart: "14:00", breakEnd: "13:00" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[1]).toBe("休憩は勤務時間の中に収めてください");
    }
  });

  it("休憩が勤務時間からはみ出したらエラー(staff_working_hours_break_within)", () => {
    const before = validateStaffWorkingHours(
      allWeekdays({
        1: { isWorking: true, breakStart: "08:00", breakEnd: "10:00" },
      }),
    );
    expect(before.ok).toBe(false);

    const after = validateStaffWorkingHours(
      allWeekdays({
        1: { isWorking: true, breakStart: "18:00", breakEnd: "20:00" },
      }),
    );
    expect(after.ok).toBe(false);

    // 勤務時間の端に接する休憩は制約どおり許す(start <= break_start / break_end <= end)
    const edge = validateStaffWorkingHours(
      allWeekdays({
        1: { isWorking: true, breakStart: "09:00", breakEnd: "19:00" },
      }),
    );
    expect(edge.ok).toBe(true);
  });

  it("休みの曜日に不正な時刻が残っていても無視する(チップを戻すだけで保存できる)", () => {
    const result = validateStaffWorkingHours(
      allWeekdays({
        1: { isWorking: false, startTime: "19:00", endTime: "09:00" },
      }),
    );
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("diffStaffWorkingHours", () => {
  it("勤務日はupsert、勤務でない曜日はdeleteの対象になる", () => {
    const diff = diffStaffWorkingHours([
      {
        weekday: 1,
        startTime: "09:00",
        endTime: "19:00",
        breakStart: null,
        breakEnd: null,
      },
      {
        weekday: 4,
        startTime: "10:00",
        endTime: "18:00",
        breakStart: "13:00",
        breakEnd: "14:00",
      },
    ]);
    expect(diff.upserts.map((row) => row.weekday)).toEqual([1, 4]);
    expect(diff.deleteWeekdays).toEqual([0, 2, 3, 5, 6]);
  });

  it("勤務日が1つも無ければ全曜日がdeleteの対象になる", () => {
    expect(diffStaffWorkingHours([]).deleteWeekdays).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe("applyTimesToWorkingDays", () => {
  it("元の曜日の時刻をほかの勤務日にコピーする(休みの曜日は変えない)", () => {
    const days = allWeekdays({
      1: {
        isWorking: true,
        startTime: "09:00",
        endTime: "19:00",
        breakStart: "13:00",
        breakEnd: "14:00",
      },
      2: { isWorking: true, startTime: "11:00", endTime: "15:00" },
      3: { isWorking: false, startTime: "08:00", endTime: "12:00" },
    });
    const applied = applyTimesToWorkingDays(days, 1);
    expect(applied[2]).toEqual({
      weekday: 2,
      isWorking: true,
      startTime: "09:00",
      endTime: "19:00",
      breakStart: "13:00",
      breakEnd: "14:00",
    });
    // 休みの曜日は触らない
    expect(applied[3]).toEqual(days[3]);
  });

  it("元の曜日が見つからなければ何もしない", () => {
    const days = allWeekdays({ 1: { isWorking: true } });
    expect(applyTimesToWorkingDays(days, 9)).toEqual(days);
  });
});

// ---------------------------------------------------------------------------
// 5. 臨時休ブロック(reservations.kind = 'block')の時間帯
// ---------------------------------------------------------------------------

describe("resolveStaffBlockRange", () => {
  const working = {
    startTime: "10:00:00",
    endTime: "19:00:00",
    breakStart: "13:00:00",
    breakEnd: "14:00:00",
  };

  it("終日はその日の実効勤務時間いっぱいを [開始, 終了) にする", () => {
    const result = resolveStaffBlockRange({
      input: {
        date: "2026-07-29",
        allDay: true,
        startTime: "",
        endTime: "",
      },
      workingDay: working,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        start: jstDateTime("2026-07-29", "10:00"),
        end: jstDateTime("2026-07-29", "19:00"),
      },
    });
  });

  it("その日にもともと勤務が無ければ終日は算出できずエラーにする", () => {
    const result = resolveStaffBlockRange({
      input: { date: "2026-07-29", allDay: true, startTime: "", endTime: "" },
      workingDay: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.time).toBe(BLOCK_NO_WORKING_DAY_MESSAGE);
    }
  });

  it("時間帯指定は勤務パターンが無くても指定範囲をそのまま使う", () => {
    const result = resolveStaffBlockRange({
      input: {
        date: "2026-07-29",
        allDay: false,
        startTime: "13:00",
        endTime: "15:30",
      },
      workingDay: null,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        start: jstDateTime("2026-07-29", "13:00"),
        end: jstDateTime("2026-07-29", "15:30"),
      },
    });
  });

  it("日付が不正ならエラーにする", () => {
    const result = resolveStaffBlockRange({
      input: {
        date: "2026-02-30",
        allDay: false,
        startTime: "13:00",
        endTime: "15:00",
      },
      workingDay: working,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.date).toBe("日付を選択してください");
    }
  });

  it("時間帯指定の時刻が未入力・不正ならエラーにする", () => {
    const missing = resolveStaffBlockRange({
      input: {
        date: "2026-07-29",
        allDay: false,
        startTime: "",
        endTime: "15:00",
      },
      workingDay: working,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.time).toBe("開始・終了の時刻を入力してください");
    }
  });

  it("時間帯指定は開始 < 終了 でなければエラーにする(空の区間を作らない)", () => {
    const result = resolveStaffBlockRange({
      input: {
        date: "2026-07-29",
        allDay: false,
        startTime: "15:00",
        endTime: "15:00",
      },
      workingDay: working,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.time).toBe("開始時刻は終了時刻より前にしてください");
    }
  });
});

describe("isBlockConflictError", () => {
  it("EXCLUDE制約違反(23P01)を、既存予約との重なりとして判定する", () => {
    expect(isBlockConflictError({ code: "23P01" })).toBe(true);
    expect(isBlockConflictError({ code: "23505" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. 臨時休の表示ラベル(モックE「7/29(水)は休診に設定済み」)
// ---------------------------------------------------------------------------

describe("describeStaffBlocks", () => {
  it("登録済みの日付を「◯月◯日(曜)は休診に設定済み」にまとめる", () => {
    expect(describeStaffBlocks([{ date: "2026-07-29" }])).toBe(
      "7月29日(水)は休診に設定済み",
    );
  });

  it("複数の日付は日付順に読点でつなぎ、同じ日は1回だけ出す", () => {
    expect(
      describeStaffBlocks([
        { date: "2026-08-03" },
        { date: "2026-07-29" },
        { date: "2026-07-29" },
      ]),
    ).toBe("7月29日(水)、8月3日(月)は休診に設定済み");
  });

  it("登録が無ければ null(補足文そのものを出さない)", () => {
    expect(describeStaffBlocks([])).toBeNull();
  });
});

describe("staffBlockLabel", () => {
  it("1件分を「◯月◯日(曜) 開始〜終了」にする", () => {
    expect(
      staffBlockLabel({
        date: "2026-07-29",
        startTime: "10:00",
        endTime: "19:00",
      }),
    ).toBe("7月29日(水) 10:00〜19:00");
  });
});

// ---------------------------------------------------------------------------
// 7. 未保存の変更の判定(節ごとの保存ボタン・「元に戻す」・変更箇所の目印)
// ---------------------------------------------------------------------------

describe("changedStaffFields", () => {
  it("保存済みの値と同じなら変更なし", () => {
    expect(changedStaffFields(staffInput(), staffInput())).toEqual([]);
  });

  it("変えた項目だけを返す", () => {
    expect(
      changedStaffFields(staffInput(), staffInput({ name: "佐藤" })),
    ).toEqual(["name"]);
    expect(
      changedStaffFields(staffInput(), staffInput({ role: "owner" })),
    ).toEqual(["role"]);
    expect(
      changedStaffFields(staffInput(), staffInput({ isActive: false })),
    ).toEqual(["isActive"]);
  });

  it("複数を変えたら項目の並び順(名前・ロール・表示順・状態・自己紹介)で返す", () => {
    expect(
      changedStaffFields(
        staffInput(),
        staffInput({ bio: "カット担当", name: "佐藤" }),
      ),
    ).toEqual(["name", "bio"]);
  });

  it("名前・自己紹介の前後の空白は変更として扱わない(保存時に落とすため)", () => {
    expect(
      changedStaffFields(
        staffInput({ name: "田中", bio: "カット担当" }),
        staffInput({ name: " 田中 ", bio: " カット担当 " }),
      ),
    ).toEqual([]);
  });

  it("自己紹介の未入力(空文字)と空白のみは同じ扱い(どちらもNULLになる)", () => {
    expect(
      changedStaffFields(staffInput({ bio: "" }), staffInput({ bio: "  " })),
    ).toEqual([]);
  });

  it("表示順は数値として突き合わせる(「1」と「 01 」は同じ)", () => {
    expect(
      changedStaffFields(
        staffInput({ displayOrder: "1" }),
        staffInput({ displayOrder: " 01 " }),
      ),
    ).toEqual([]);
    expect(
      changedStaffFields(
        staffInput({ displayOrder: "1" }),
        staffInput({ displayOrder: "2" }),
      ),
    ).toEqual(["displayOrder"]);
  });

  it("表示順が数値として読めない入力は文字列として突き合わせる(エラーは検証側の仕事)", () => {
    expect(
      changedStaffFields(
        staffInput({ displayOrder: "1" }),
        staffInput({ displayOrder: "" }),
      ),
    ).toEqual(["displayOrder"]);
  });

  it("値を変えてから手で元の値に戻すと変更なしに戻る", () => {
    const saved = staffInput({ name: "田中" });
    expect(changedStaffFields(saved, staffInput({ name: "佐藤" }))).toEqual([
      "name",
    ]);
    expect(changedStaffFields(saved, staffInput({ name: "田中" }))).toEqual([]);
  });
});

describe("changedWorkingDayWeekdays", () => {
  it("勤務曜日のON/OFFを切り替えた曜日を返す", () => {
    expect(
      changedWorkingDayWeekdays(
        allWeekdays({ 1: { isWorking: true } }),
        allWeekdays({ 1: { isWorking: true }, 4: { isWorking: true } }),
      ),
    ).toEqual([4]);
  });

  it("時刻・休憩を変えた曜日だけを返す", () => {
    expect(
      changedWorkingDayWeekdays(
        allWeekdays({ 1: { isWorking: true }, 2: { isWorking: true } }),
        allWeekdays({
          1: { isWorking: true },
          2: { isWorking: true, breakStart: "13:00", breakEnd: "14:00" },
        }),
      ),
    ).toEqual([2]);
  });

  it("「09:00」と「9:00」・前後の空白・秒付きは同じ時刻として扱う", () => {
    expect(
      changedWorkingDayWeekdays(
        allWeekdays({ 1: { isWorking: true, startTime: "09:00" } }),
        allWeekdays({ 1: { isWorking: true, startTime: " 9:00 " } }),
      ),
    ).toEqual([]);
    expect(
      changedWorkingDayWeekdays(
        allWeekdays({ 1: { isWorking: true, startTime: "09:00:00" } }),
        allWeekdays({ 1: { isWorking: true, startTime: "09:00" } }),
      ),
    ).toEqual([]);
  });

  it("休みの曜日に残った時刻は変更として扱わない(行そのものが消えるため)", () => {
    expect(
      changedWorkingDayWeekdays(
        allWeekdays({ 3: { isWorking: false, startTime: "", endTime: "" } }),
        allWeekdays({
          3: { isWorking: false, startTime: "10:00", endTime: "18:00" },
        }),
      ),
    ).toEqual([]);
  });

  it("変更した曜日が複数あれば曜日順に返す", () => {
    expect(
      changedWorkingDayWeekdays(
        allWeekdays({ 1: { isWorking: true }, 5: { isWorking: true } }),
        allWeekdays({
          1: { isWorking: true, endTime: "20:00" },
          5: { isWorking: false },
        }),
      ),
    ).toEqual([1, 5]);
  });
});
