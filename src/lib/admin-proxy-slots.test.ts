import { describe, expect, it } from "vitest";

import type { BusyRange } from "./availability";

import {
  buildProxySlotOptions,
  describeSlotAvailability,
} from "./admin-proxy-slots";
import { jstDateTime } from "./jst";

// ---------------------------------------------------------------------------
// 1. 代行登録の空き判定メッセージ
// ---------------------------------------------------------------------------

describe("describeSlotAvailability: 代行登録の空き判定メッセージ", () => {
  // 営業 9:00〜18:00 / スタッフは 10:00〜18:00 勤務・13:00〜14:00 休憩 /
  // 30分刻み・30日先まで・60分前締切(値はすべて引数から差し込む)
  const businessDay = {
    isOpen: true,
    openTime: "09:00:00",
    closeTime: "18:00:00",
  };
  const working = {
    startTime: "10:00:00",
    endTime: "18:00:00",
    breakStart: "13:00:00",
    breakEnd: "14:00:00",
  };
  const policy = {
    slotIntervalMinutes: 30,
    bookingWindowDays: 30,
    minLeadMinutes: 60,
  };
  // 対象日(2026-07-18 土)より前の基準時刻(過去・直前締切に引っかからない)
  const now = jstDateTime("2026-07-17", "10:00");
  const at = (time: string) => jstDateTime("2026-07-18", time);
  const base = {
    durationMinutes: 60,
    businessDay,
    isClosedDay: false,
    working,
    busy: [] as BusyRange[],
    policy,
    now,
    staffName: "田中",
  };

  describe("空いている枠", () => {
    it("available・canRegister:true・確保分数入りメッセージ(理由は付かない)", () => {
      expect(describeSlotAvailability({ ...base, start: at("10:00") })).toEqual(
        {
          status: "available",
          canRegister: true,
          message: "この枠は空いています。60分確保できます。",
        },
      );
    });

    it("確保できる分数は選択メニューの合計所要分", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("15:30"),
          durationMinutes: 150,
        }).message,
      ).toBe("この枠は空いています。150分確保できます。");
    });
  });

  describe("1. past: 過去の時間(登録不可)", () => {
    it("開始が現在より前(厳密に過去)なら past・canRegister:false", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          now: at("10:01"),
        }),
      ).toEqual({
        status: "past",
        reason: "past",
        canRegister: false,
        message: "過去の時間は登録できません",
      });
    });

    it("開始ちょうど(start===now)は過去扱いしない", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          now: at("10:00"),
        }).status,
      ).not.toBe("past");
    });

    it("過去は定休日より優先する", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          now: at("10:01"),
          isClosedDay: true,
        }).status,
      ).toBe("past");
    });
  });

  describe("2. closed: 定休日(登録不可)", () => {
    it("休業日ルール(isClosedDay)なら closed・canRegister:false", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          isClosedDay: true,
        }),
      ).toEqual({
        status: "closed",
        reason: "closed",
        canRegister: false,
        message: "定休日は登録できません",
      });
    });

    it("営業時間の行が休業(is_open=false)でも closed", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          businessDay: { isOpen: false, openTime: null, closeTime: null },
        }).status,
      ).toBe("closed");
    });

    it("定休日は勤務が無くても closed を優先する", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          isClosedDay: true,
          working: null,
        }).reason,
      ).toBe("closed");
    });
  });

  describe("3. no_working_day: その日の勤務がない", () => {
    it("スタッフ名があれば「◯◯さんはこの日の勤務がありません」", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          working: null,
        }),
      ).toEqual({
        status: "unavailable",
        reason: "no_working_day",
        canRegister: true,
        message: "田中さんはこの日の勤務がありません",
      });
    });

    it("スタッフ名が無ければ「この日は勤務がありません」", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          working: null,
          staffName: undefined,
        }).message,
      ).toBe("この日は勤務がありません");
    });
  });

  describe("4. outside_booking_window: 受付期間外", () => {
    it("受付期間の日数を差し込んだメッセージを返す", () => {
      // 基準日 2026-07-17 + 30日 = 2026-08-16 まで。8/17 は期間外
      expect(
        describeSlotAvailability({
          ...base,
          start: jstDateTime("2026-08-17", "10:00"),
        }),
      ).toEqual({
        status: "unavailable",
        reason: "outside_booking_window",
        canRegister: true,
        message: "受付期間(30日先まで)を超えています",
      });
    });

    it("受付期間の最終日(ちょうど30日先)は期間内として扱う", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: jstDateTime("2026-08-16", "10:00"),
        }).status,
      ).toBe("available");
    });

    it("日数は店舗設定の値をそのまま出す(7日先までの店舗)", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: jstDateTime("2026-08-16", "10:00"),
          policy: { ...policy, bookingWindowDays: 7 },
        }).message,
      ).toBe("受付期間(7日先まで)を超えています");
    });
  });

  describe("5. too_soon: 直前締切", () => {
    it("締切分数を差し込んだメッセージを返す", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          now: at("09:30"), // 締切60分前 → 10:30 以降しか受け付けない
        }),
      ).toEqual({
        status: "unavailable",
        reason: "too_soon",
        canRegister: true,
        message: "直前すぎます(60分前までに受付)",
      });
    });

    it("締切ちょうど(start === now + 締切分)は直前すぎない", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          now: at("09:00"),
        }).status,
      ).toBe("available");
    });

    it("分数は店舗設定の値をそのまま出す(120分前締切の店舗)", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          now: at("09:30"),
          policy: { ...policy, minLeadMinutes: 120 },
        }).message,
      ).toBe("直前すぎます(120分前までに受付)");
    });
  });

  describe("6. duration_not_fit: 閉店までに所要時間が収まらない", () => {
    it("閉店時刻と所要分を差し込んだメッセージを返す", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("16:00"),
          durationMinutes: 150,
        }),
      ).toEqual({
        status: "unavailable",
        reason: "duration_not_fit",
        canRegister: true,
        message: "18:00の閉店までに150分は確保できません",
      });
    });

    it("閉店ちょうどに終わる(t + 所要分 === 閉店)なら収まる", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("15:30"),
          durationMinutes: 150,
        }).status,
      ).toBe("available");
    });

    it("閉店時刻は営業時間の値をそのまま出す(19:30 閉店の店舗)", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("19:00"),
          durationMinutes: 60,
          businessDay: { ...businessDay, closeTime: "19:30:00" },
        }).message,
      ).toBe("19:30の閉店までに60分は確保できません");
    });
  });

  describe("7. during_break: 休憩と重なる", () => {
    it("休憩の開始・終了を差し込んだメッセージを返す", () => {
      expect(describeSlotAvailability({ ...base, start: at("13:00") })).toEqual(
        {
          status: "unavailable",
          reason: "during_break",
          canRegister: true,
          message: "休憩時間です(13:00〜14:00)",
        },
      );
    });

    it("休憩にまたがる(終了が休憩に食い込む)場合も during_break", () => {
      expect(
        describeSlotAvailability({ ...base, start: at("12:30") }).reason,
      ).toBe("during_break");
    });

    it("休憩の直前に終わる(終了 === 休憩開始)は重なりではない", () => {
      expect(
        describeSlotAvailability({ ...base, start: at("12:00") }).status,
      ).toBe("available");
    });

    it("休憩明けちょうど(開始 === 休憩終了)は重なりではない", () => {
      expect(
        describeSlotAvailability({ ...base, start: at("14:00") }).status,
      ).toBe("available");
    });

    it("休憩と勤務時間外の両方に当たるときは休憩を優先する", () => {
      // 勤務 14:00〜18:00・休憩 13:00〜14:00 のスタッフの 13:00
      expect(
        describeSlotAvailability({
          ...base,
          start: at("13:00"),
          working: { ...working, startTime: "14:00:00" },
        }).reason,
      ).toBe("during_break");
    });

    describe("休憩の無い勤務(breakStart・breakEnd が null)", () => {
      const noBreak = { ...working, breakStart: null, breakEnd: null };

      it("休憩の判定を飛ばし、勤務時間内なら空き(休憩ありの勤務なら休憩にあたる13:00でも)", () => {
        expect(
          describeSlotAvailability({
            ...base,
            start: at("13:00"),
            working: noBreak,
          }),
        ).toEqual({
          status: "available",
          canRegister: true,
          message: "この枠は空いています。60分確保できます。",
        });
      });

      it("勤務時間外なら outside_working_hours", () => {
        expect(
          describeSlotAvailability({
            ...base,
            start: at("09:00"),
            working: noBreak,
          }),
        ).toEqual({
          status: "unavailable",
          reason: "outside_working_hours",
          canRegister: true,
          message: "勤務時間外です(10:00〜18:00)",
        });
      });
    });
  });

  describe("8. outside_working_hours: 勤務時間外", () => {
    it("勤務区間(営業時間と勤務時間の重なり)を差し込んだメッセージを返す", () => {
      expect(describeSlotAvailability({ ...base, start: at("09:00") })).toEqual(
        {
          status: "unavailable",
          reason: "outside_working_hours",
          canRegister: true,
          message: "勤務時間外です(10:00〜18:00)",
        },
      );
    });

    it("勤務開始ちょうどは勤務時間内", () => {
      expect(
        describeSlotAvailability({ ...base, start: at("10:00") }).status,
      ).toBe("available");
    });

    it("勤務終了をまたぐ(終了 > 勤務終了)なら勤務時間外", () => {
      // 勤務 10:00〜17:00 のスタッフが 16:30 から60分
      expect(
        describeSlotAvailability({
          ...base,
          start: at("16:30"),
          working: { ...working, endTime: "17:00:00" },
        }),
      ).toEqual({
        status: "unavailable",
        reason: "outside_working_hours",
        canRegister: true,
        message: "勤務時間外です(10:00〜17:00)",
      });
    });

    it("勤務区間は営業時間で切り詰めた範囲を出す(勤務 8:00〜19:00・営業 9:00〜18:00)", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("08:00"),
          working: {
            ...working,
            startTime: "08:00:00",
            endTime: "19:00:00",
          },
        }).message,
      ).toBe("勤務時間外です(9:00〜18:00)");
    });
  });

  describe("9. overlaps_reservation: 既存の予約・ブロックと重なる", () => {
    const busy: BusyRange[] = [{ start: at("11:00"), end: at("12:00") }];

    it("重なる時間は overlaps_reservation・canRegister:true(最終判定はEXCLUDE制約)", () => {
      expect(
        describeSlotAvailability({ ...base, start: at("11:00"), busy }),
      ).toEqual({
        status: "unavailable",
        reason: "overlaps_reservation",
        canRegister: true,
        message: "この時間は他の予約と重なっています",
      });
    });

    it("既存予約の終了ちょうどから始まるのは重なりではない(半開区間)", () => {
      expect(
        describeSlotAvailability({ ...base, start: at("12:00"), busy }).status,
      ).toBe("available");
    });

    it("既存予約の開始ちょうどに終わるのは重なりではない(半開区間)", () => {
      expect(
        describeSlotAvailability({ ...base, start: at("10:00"), busy }).status,
      ).toBe("available");
    });

    it("勤務時間外の重なりは勤務時間外を優先する(判定順)", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("09:00"),
          busy: [{ start: at("09:00"), end: at("10:00") }],
        }).reason,
      ).toBe("outside_working_hours");
    });
  });

  describe("10. off_grid: 枠の刻みに合わない", () => {
    it("刻みの分数を差し込んだメッセージを返す", () => {
      expect(describeSlotAvailability({ ...base, start: at("10:15") })).toEqual(
        {
          status: "unavailable",
          reason: "off_grid",
          canRegister: true,
          message: "開始時刻が30分刻みに合っていません",
        },
      );
    });

    it("刻みは店舗設定の値をそのまま出す(15分刻みの店舗なら 10:15 は空き)", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:15"),
          policy: { ...policy, slotIntervalMinutes: 15 },
        }).status,
      ).toBe("available");
    });

    it("刻みの基準は開店時刻(9:15 開店なら 10:00 は刻みに合わない)", () => {
      expect(
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          businessDay: { ...businessDay, openTime: "09:15:00" },
        }),
      ).toEqual({
        status: "unavailable",
        reason: "off_grid",
        canRegister: true,
        message: "開始時刻が30分刻みに合っていません",
      });
    });
  });

  describe("登録の可否", () => {
    it("canRegister が false なのは past と closed だけ(他は店側の上書きを許す)", () => {
      const cases = [
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          now: at("10:01"),
        }), // past
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          isClosedDay: true,
        }), // closed
        describeSlotAvailability({
          ...base,
          start: at("10:00"),
          working: null,
        }), // no_working_day
        describeSlotAvailability({ ...base, start: at("13:00") }), // during_break
        describeSlotAvailability({ ...base, start: at("09:00") }), // outside_working_hours
        describeSlotAvailability({ ...base, start: at("10:15") }), // off_grid
      ];
      expect(cases.map((result) => result.canRegister)).toEqual([
        false,
        false,
        true,
        true,
        true,
        true,
      ]);
    });

    it("「埋まっています」と断定しない(店側は上書き登録できる)", () => {
      const messages = [
        describeSlotAvailability({ ...base, start: at("13:00") }).message,
        describeSlotAvailability({ ...base, start: at("09:00") }).message,
      ];
      for (const message of messages) {
        expect(message).not.toBe("この枠は埋まっています");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 2. buildProxySlotOptions(代行登録の「その日の空き時間」一覧)
// ---------------------------------------------------------------------------

describe("buildProxySlotOptions", () => {
  it("開始時刻(UTCのISO)をJSTの壁時計時刻 HH:MM(ゼロ埋め)に変換する", () => {
    const options = buildProxySlotOptions([
      {
        startISO: jstDateTime("2026-07-18", "09:00").toISOString(),
        status: "available",
      },
      {
        startISO: jstDateTime("2026-07-18", "13:30").toISOString(),
        status: "available",
      },
    ]);
    expect(options.map((o) => o.time)).toEqual(["09:00", "13:30"]);
  });

  it("埋まっている枠は isTaken=true(取り消し線+選択不可の目印)にする", () => {
    const options = buildProxySlotOptions([
      {
        startISO: jstDateTime("2026-07-18", "10:00").toISOString(),
        status: "taken",
      },
      {
        startISO: jstDateTime("2026-07-18", "11:00").toISOString(),
        status: "available",
      },
    ]);
    expect(options.map((o) => o.isTaken)).toEqual([true, false]);
  });

  it("順不同で渡されても開始時刻の昇順に並べ替える", () => {
    const options = buildProxySlotOptions([
      {
        startISO: jstDateTime("2026-07-18", "15:00").toISOString(),
        status: "available",
      },
      {
        startISO: jstDateTime("2026-07-18", "09:30").toISOString(),
        status: "taken",
      },
      {
        startISO: jstDateTime("2026-07-18", "12:00").toISOString(),
        status: "available",
      },
    ]);
    expect(options.map((o) => o.time)).toEqual(["09:30", "12:00", "15:00"]);
  });

  it("日をまたぐ深夜帯(JSTの前日扱いにならないこと)も壁時計時刻で表す", () => {
    // JST 2026-07-18 00:30 は UTC では 2026-07-17 15:30
    const options = buildProxySlotOptions([
      {
        startISO: jstDateTime("2026-07-18", "00:30").toISOString(),
        status: "available",
      },
    ]);
    expect(options[0].time).toBe("00:30");
  });

  it("空き枠が無ければ空配列を返す(呼び出し側が「空き枠はありません」を出す)", () => {
    expect(buildProxySlotOptions([])).toEqual([]);
  });

  it("入力の配列を破壊的に並べ替えない", () => {
    const slots = [
      {
        startISO: jstDateTime("2026-07-18", "15:00").toISOString(),
        status: "available" as const,
      },
      {
        startISO: jstDateTime("2026-07-18", "09:30").toISOString(),
        status: "available" as const,
      },
    ];
    const before = slots.map((s) => s.startISO);
    buildProxySlotOptions(slots);
    expect(slots.map((s) => s.startISO)).toEqual(before);
  });
});
