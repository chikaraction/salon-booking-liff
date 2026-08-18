import { describe, expect, it } from "vitest";

import { jstDateTime, type Slot } from "./availability";

import {
  buildDayTimeline,
  buildProxySlotOptions,
  buildReservationDetailLabels,
  buildReservationListItems,
  buildWeekView,
  dayNavLabel,
  isClosedByBusinessHours,
  isJstToday,
  moveDay,
  moveWeek,
  slotAvailabilityMessage,
  weekNavLabel,
  weekStartOf,
  type AdminCalendarItem,
} from "./admin-calendar";

// ---------------------------------------------------------------------------
// 共通のテストデータ(JST 2026-07-18 は土曜)
// ---------------------------------------------------------------------------

const staff = [
  { id: "tanaka", name: "田中", role: "owner" as const },
  { id: "sato", name: "佐藤", role: "staff" as const },
];

/** 営業 9:00〜19:00(時間軸600分。%が整数になるよう選ぶ) */
const businessDay = {
  isOpen: true,
  openTime: "09:00:00",
  closeTime: "19:00:00",
};

const workingHours = [
  {
    staffId: "tanaka",
    startTime: "09:00:00",
    endTime: "19:00:00",
    breakStart: null,
    breakEnd: null,
  },
  {
    staffId: "sato",
    startTime: "10:00:00",
    endTime: "19:00:00",
    breakStart: "13:00:00",
    breakEnd: "13:30:00",
  },
];

function booking(params: {
  id: string;
  staffId: string;
  date?: string;
  start: string; // "HH:MM"(JST壁時計)
  end: string;
  customerName: string;
  menus: Array<{ menuName: string; price: number; durationMinutes: number }>;
}): AdminCalendarItem {
  const date = params.date ?? "2026-07-18";
  return {
    kind: "booking",
    id: params.id,
    staffId: params.staffId,
    during: {
      start: jstDateTime(date, params.start),
      end: jstDateTime(date, params.end),
    },
    customerName: params.customerName,
    menus: params.menus,
  };
}

function block(params: {
  id: string;
  staffId: string;
  date?: string;
  start: string;
  end: string;
}): AdminCalendarItem {
  const date = params.date ?? "2026-07-18";
  return {
    kind: "block",
    id: params.id,
    staffId: params.staffId,
    during: {
      start: jstDateTime(date, params.start),
      end: jstDateTime(date, params.end),
    },
  };
}

const cut = { menuName: "カット", price: 4950, durationMinutes: 60 };
const color = { menuName: "カラー", price: 6600, durationMinutes: 90 };
const perm = { menuName: "パーマ", price: 9900, durationMinutes: 120 };

// ---------------------------------------------------------------------------
// 1. 日表示の配置計算
// ---------------------------------------------------------------------------

describe("buildDayTimeline: 日表示の配置計算", () => {
  const base = {
    date: "2026-07-18",
    businessDay,
    staff,
    workingHours,
  };

  it("時間軸の目盛りは営業時間に合わせて1時間刻み(時は先頭0なし)", () => {
    const timeline = buildDayTimeline({ ...base, items: [] });
    expect(timeline.isClosed).toBe(false);
    expect(timeline.ticks).toEqual([
      "9:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
      "19:00",
    ]);
  });

  it("目盛りには時間軸上の位置(top%)も付く(グリッド線の描画用)", () => {
    const timeline = buildDayTimeline({ ...base, items: [] });
    // 9:00〜19:00(600分)→ 1時間 = 10%
    expect(timeline.tickMarks[0]).toEqual({ label: "9:00", topPercent: 0 });
    expect(timeline.tickMarks[1]).toEqual({ label: "10:00", topPercent: 10 });
    expect(timeline.tickMarks[timeline.tickMarks.length - 1]).toEqual({
      label: "19:00",
      topPercent: 100,
    });
    expect(timeline.tickMarks.map((m) => m.label)).toEqual(timeline.ticks);
  });

  it("開店が正時でない場合、最初の目盛りは0%より下に置く", () => {
    // 9:30〜19:30(600分)→ 最初の目盛り 10:00 は開店から30分 = 5%
    const timeline = buildDayTimeline({
      ...base,
      businessDay: {
        isOpen: true,
        openTime: "09:30:00",
        closeTime: "19:30:00",
      },
      items: [],
    });
    expect(timeline.tickMarks[0]).toEqual({ label: "10:00", topPercent: 5 });
    expect(timeline.tickMarks[timeline.tickMarks.length - 1]).toEqual({
      label: "19:00",
      topPercent: 95,
    });
  });

  it("休業日は目盛り位置も空", () => {
    const timeline = buildDayTimeline({
      ...base,
      businessDay: { isOpen: false, openTime: null, closeTime: null },
      items: [],
    });
    expect(timeline.tickMarks).toEqual([]);
  });

  it("スタッフ列は入力順で、見出しは「田中(オーナー)」形式", () => {
    const timeline = buildDayTimeline({ ...base, items: [] });
    expect(timeline.columns.map((c) => c.staffId)).toEqual(["tanaka", "sato"]);
    expect(timeline.columns[0].heading).toBe("田中(オーナー)");
    expect(timeline.columns[1].heading).toBe("佐藤(スタッフ)");
  });

  it("予約は開始時刻と長さから top%・height% を計算する", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "b1",
          staffId: "tanaka",
          start: "09:30",
          end: "10:30",
          customerName: "佐々木",
          menus: [cut],
        }),
      ],
    });
    const placed = timeline.columns[0].blocks[0];
    // 9:30 = 営業開始から30分 → 30/600 = 5%、60分 → 10%
    expect(placed.topPercent).toBe(5);
    expect(placed.heightPercent).toBe(10);
    expect(placed.type).toBe("booking");
    expect(placed.id).toBe("b1");
  });

  it("ラベルは「9:30 佐々木様」形式。60分以下は所要分を省略し料金も出さない", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "b1",
          staffId: "tanaka",
          start: "09:30",
          end: "10:30",
          customerName: "佐々木",
          menus: [cut],
        }),
      ],
    });
    const placed = timeline.columns[0].blocks[0];
    expect(placed.titleLabel).toBe("9:30 佐々木様");
    expect(placed.menuLabel).toBe("カット");
    expect(placed.priceLabel).toBeNull();
  });

  it("複数メニューは「カット + カラー(150分)」形式で、150分以上なら料金も表示", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "b2",
          staffId: "tanaka",
          start: "11:00",
          end: "13:30",
          customerName: "山田",
          menus: [cut, color],
        }),
      ],
    });
    const placed = timeline.columns[0].blocks[0];
    expect(placed.titleLabel).toBe("11:00 山田様");
    expect(placed.menuLabel).toBe("カット + カラー(150分)");
    expect(placed.priceLabel).toBe("¥11,550");
    expect(placed.topPercent).toBe(20); // 11:00 = 120分 → 20%
    expect(placed.heightPercent).toBe(25); // 150分 → 25%
  });

  it("120分は所要分を表示するが料金は出さない(モック準拠)", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "b3",
          staffId: "sato",
          start: "10:00",
          end: "12:00",
          customerName: "鈴木",
          menus: [perm],
        }),
      ],
    });
    const placed = timeline.columns[1].blocks.find((b) => b.id === "b3");
    expect(placed?.menuLabel).toBe("パーマ(120分)");
    expect(placed?.priceLabel).toBeNull();
  });

  it("営業開始ちょうどは上端(0%)、営業終了ちょうどは下端(合計100%)に接する", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "open-edge",
          staffId: "tanaka",
          start: "09:00",
          end: "10:00",
          customerName: "朝一",
          menus: [cut],
        }),
        booking({
          id: "close-edge",
          staffId: "tanaka",
          start: "18:00",
          end: "19:00",
          customerName: "終業前",
          menus: [cut],
        }),
      ],
    });
    const blocks = timeline.columns[0].blocks;
    const first = blocks.find((b) => b.id === "open-edge");
    const last = blocks.find((b) => b.id === "close-edge");
    expect(first?.topPercent).toBe(0);
    expect(last !== undefined && last.topPercent + last.heightPercent).toBe(
      100,
    );
  });

  it("休憩は勤務パターンから擬似ブロックとして生成する", () => {
    const timeline = buildDayTimeline({ ...base, items: [] });
    const breaks = timeline.columns[1].blocks.filter((b) => b.type === "break");
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toEqual({
      id: null,
      type: "break",
      topPercent: 40, // 13:00 = 240分 → 40%
      heightPercent: 5, // 30分 → 5%
      titleLabel: "休憩 13:00–13:30",
      menuLabel: null,
      priceLabel: null,
    });
  });

  it("休憩のないスタッフには休憩ブロックを作らない", () => {
    const timeline = buildDayTimeline({ ...base, items: [] });
    expect(
      timeline.columns[0].blocks.filter((b) => b.type === "break"),
    ).toHaveLength(0);
  });

  it("営業時間の端にまたがる休憩は表示範囲に切り詰める(ラベルは元の時刻)", () => {
    const timeline = buildDayTimeline({
      ...base,
      workingHours: [
        {
          staffId: "tanaka",
          startTime: "09:00:00",
          endTime: "19:00:00",
          breakStart: "18:30:00",
          breakEnd: "19:30:00", // 閉店をまたぐ
        },
      ],
      items: [],
    });
    const brk = timeline.columns[0].blocks[0];
    expect(brk.type).toBe("break");
    expect(brk.topPercent).toBe(95); // 18:30 = 570分 → 95%
    expect(brk.heightPercent).toBe(5); // 19:00 で切り詰め → 30分
    expect(brk.titleLabel).toBe("休憩 18:30–19:30");
  });

  it("ブロック(予約不可)は営業時間の外にはみ出す分を切り詰める", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        block({ id: "blk1", staffId: "tanaka", start: "08:00", end: "10:00" }),
      ],
    });
    const placed = timeline.columns[0].blocks[0];
    expect(placed.type).toBe("block");
    expect(placed.topPercent).toBe(0); // 開店前は 0% に切り詰め
    expect(placed.heightPercent).toBe(10); // 表示されるのは 9:00〜10:00 の60分
    expect(placed.titleLabel).toBe("予約不可 8:00–10:00");
    expect(placed.menuLabel).toBeNull();
    expect(placed.priceLabel).toBeNull();
  });

  it("営業時間と全く重ならないアイテムは配置しない", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        block({ id: "night", staffId: "tanaka", start: "20:00", end: "22:00" }),
      ],
    });
    expect(timeline.columns[0].blocks).toHaveLength(0);
  });

  it("担当スタッフごとの列に振り分ける", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "b1",
          staffId: "tanaka",
          start: "09:30",
          end: "10:30",
          customerName: "佐々木",
          menus: [cut],
        }),
        booking({
          id: "b3",
          staffId: "sato",
          start: "10:00",
          end: "12:00",
          customerName: "鈴木",
          menus: [perm],
        }),
      ],
    });
    expect(timeline.columns[0].blocks.map((b) => b.id)).toEqual(["b1"]);
    expect(
      timeline.columns[1].blocks
        .filter((b) => b.type === "booking")
        .map((b) => b.id),
    ).toEqual(["b3"]);
  });

  it("休業日で予約がなければ目盛りなし・列は空で isClosed=true(UIは「定休日です。」)", () => {
    const timeline = buildDayTimeline({
      ...base,
      businessDay: { isOpen: false, openTime: null, closeTime: null },
      items: [],
    });
    expect(timeline.isClosed).toBe(true);
    expect(timeline.ticks).toEqual([]);
    expect(timeline.columns).toHaveLength(2);
    expect(timeline.columns.every((c) => c.blocks.length === 0)).toBe(true);
  });

  it("休業日でも予約があれば予約の範囲で軸を組み配置する(isClosed=true のまま隠さない)", () => {
    const timeline = buildDayTimeline({
      ...base,
      businessDay: { isOpen: false, openTime: null, closeTime: null },
      items: [
        booking({
          id: "b1",
          staffId: "tanaka",
          start: "09:30",
          end: "10:30",
          customerName: "佐々木",
          menus: [cut],
        }),
      ],
    });
    // 定休日バッジを出すため isClosed は true のまま
    expect(timeline.isClosed).toBe(true);
    // 9:30〜10:30 → 軸は 9:00〜11:00(正時に丸め)
    expect(timeline.ticks).toEqual(["9:00", "10:00", "11:00"]);
    const placed = timeline.columns[0].blocks[0];
    expect(placed.id).toBe("b1");
    // 軸 9:00〜11:00(120分)基準: 9:30 = 30分 → 25%、60分 → 50%
    expect(placed.topPercent).toBe(25);
    expect(placed.heightPercent).toBe(50);
    // 予約のないスタッフ列も生成される(ブロックは空)
    expect(timeline.columns[1].blocks).toHaveLength(0);
  });

  it("休業日+予約ありでも勤務パターンがなければ休憩ブロックは出さない", () => {
    const timeline = buildDayTimeline({
      ...base,
      businessDay: { isOpen: false, openTime: null, closeTime: null },
      workingHours: [], // 休業日は勤務パターンなし
      items: [
        booking({
          id: "b1",
          staffId: "sato",
          start: "10:00",
          end: "11:00",
          customerName: "鈴木",
          menus: [cut],
        }),
      ],
    });
    expect(
      timeline.columns
        .flatMap((c) => c.blocks)
        .filter((b) => b.type === "break"),
    ).toHaveLength(0);
  });

  it("勤務パターンのないスタッフの列も生成する(休憩ブロックなし)", () => {
    const timeline = buildDayTimeline({
      ...base,
      workingHours: workingHours.filter((w) => w.staffId !== "sato"),
      items: [],
    });
    expect(timeline.columns[1].staffId).toBe("sato");
    expect(timeline.columns[1].blocks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. 週表示への集約
// ---------------------------------------------------------------------------

describe("buildWeekView: 週表示への集約", () => {
  // 日曜定休。平日 10:00〜18:00、土曜 9:00〜19:00 → 週の時間軸は 9:00〜19:00
  const businessHours = [
    { weekday: 0, isOpen: false, openTime: null, closeTime: null },
    ...[1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      isOpen: true,
      openTime: "10:00:00",
      closeTime: "18:00:00",
    })),
    { weekday: 6, isOpen: true, openTime: "09:00:00", closeTime: "19:00:00" },
  ];
  const isClosedDay = (date: string) =>
    isClosedByBusinessHours(date, businessHours);
  const weekStart = "2026-07-12"; // 日曜

  it("週の開始(日曜)から7日分を日別にグルーピングする", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [],
      isClosedDay,
    });
    expect(view.days.map((d) => d.date)).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
    expect(view.days.map((d) => d.dayNumber)).toEqual([
      12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(view.days.map((d) => d.weekdayLabel)).toEqual([
      "日",
      "月",
      "火",
      "水",
      "木",
      "金",
      "土",
    ]);
  });

  it("定休日判定は入力の判定関数に従う(business_hours 由来)", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [],
      isClosedDay,
    });
    expect(view.days.map((d) => d.isClosed)).toEqual([
      true, // 日曜定休
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("将来の休業ルール(第◯曜日・祝日)も同じ判定関数の入力に載せられる", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [],
      // 例: 2026-07-15 を臨時休業にするルール
      isClosedDay: (date) => date === "2026-07-15" || isClosedDay(date),
    });
    expect(view.days[3].isClosed).toBe(true);
  });

  it("時間軸は週内の営業時間の最小開店〜最大閉店(土曜の9:00〜19:00)", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [],
      isClosedDay,
    });
    expect(view.ticks[0]).toBe("9:00");
    expect(view.ticks[view.ticks.length - 1]).toBe("19:00");
  });

  it("週の目盛りにも時間軸上の位置(top%)が付く", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [],
      isClosedDay,
    });
    // 9:00〜19:00(600分)→ 1時間 = 10%
    expect(view.tickMarks[0]).toEqual({ label: "9:00", topPercent: 0 });
    expect(view.tickMarks[view.tickMarks.length - 1]).toEqual({
      label: "19:00",
      topPercent: 100,
    });
    expect(view.tickMarks.map((m) => m.label)).toEqual(view.ticks);
  });

  it("各アイテムは開始時刻+客名のラベルとスタッフID(色分け用)を持つ", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [
        booking({
          id: "w1",
          staffId: "tanaka",
          date: "2026-07-13",
          start: "10:00",
          end: "11:00",
          customerName: "森",
          menus: [cut],
        }),
        booking({
          id: "w2",
          staffId: "sato",
          date: "2026-07-18",
          start: "11:00",
          end: "13:30",
          customerName: "山田",
          menus: [cut, color],
        }),
      ],
      isClosedDay,
    });
    const mon = view.days[1].items;
    expect(mon).toHaveLength(1);
    expect(mon[0].titleLabel).toBe("10:00 森様");
    expect(mon[0].staffId).toBe("tanaka");
    // 60分以下はメニュー名を省略(モック準拠)
    expect(mon[0].menuLabel).toBeNull();

    const sat = view.days[6].items;
    expect(sat[0].titleLabel).toBe("11:00 山田様");
    expect(sat[0].menuLabel).toBe("カット + カラー");
    expect(sat[0].staffId).toBe("sato");
    // 週の時間軸(9:00〜19:00=600分)基準: 11:00 = 120分 → 20%、150分 → 25%
    expect(sat[0].topPercent).toBe(20);
    expect(sat[0].heightPercent).toBe(25);
  });

  it("週の範囲外(前週土曜・翌週日曜)の予約は含めない", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [
        booking({
          id: "prev",
          staffId: "tanaka",
          date: "2026-07-11",
          start: "10:00",
          end: "11:00",
          customerName: "前週",
          menus: [cut],
        }),
        booking({
          id: "next",
          staffId: "tanaka",
          date: "2026-07-19",
          start: "10:00",
          end: "11:00",
          customerName: "翌週",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.days.every((d) => d.items.length === 0)).toBe(true);
  });

  it("ブロック(kind=block)は週表示に載せない", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [
        block({
          id: "blk",
          staffId: "tanaka",
          date: "2026-07-14",
          start: "10:00",
          end: "12:00",
        }),
      ],
      isClosedDay,
    });
    expect(view.days[2].items).toHaveLength(0);
  });

  it("定休日でも予約があれば day.items に配置する(定休日の予約を隠さない)", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [
        // 日曜(定休)に別経路・過去作成の予約が入っているケース
        booking({
          id: "sun",
          staffId: "tanaka",
          date: "2026-07-12",
          start: "10:00",
          end: "11:00",
          customerName: "日曜",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.days[0].isClosed).toBe(true);
    expect(view.days[0].items.map((i) => i.id)).toEqual(["sun"]);
  });

  it("営業時間外の予約も軸に含めて配置する(軸から外れて消えない)", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [
        // 平日営業は 10:00〜だが、8:00 開始の予約(時間外)が消えないこと
        booking({
          id: "early",
          staffId: "tanaka",
          date: "2026-07-13",
          start: "08:00",
          end: "09:00",
          customerName: "早朝",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    // 8:00 が軸下限に入る(営業時間の最小開店 9:00 より前へ広がる)
    expect(view.ticks[0]).toBe("8:00");
    expect(view.days[1].items.map((i) => i.id)).toEqual(["early"]);
  });

  it("同じ日のアイテムは開始時刻順に並べる", () => {
    const view = buildWeekView({
      weekStart,
      businessHours,
      items: [
        booking({
          id: "late",
          staffId: "tanaka",
          date: "2026-07-14",
          start: "14:00",
          end: "15:00",
          customerName: "谷",
          menus: [cut],
        }),
        booking({
          id: "early",
          staffId: "sato",
          date: "2026-07-14",
          start: "11:00",
          end: "12:00",
          customerName: "岡",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.days[2].items.map((i) => i.id)).toEqual(["early", "late"]);
  });
});

describe("isClosedByBusinessHours: 定休日判定", () => {
  const businessHours = [
    { weekday: 0, isOpen: false, openTime: null, closeTime: null },
    { weekday: 6, isOpen: true, openTime: "09:00:00", closeTime: "19:00:00" },
  ];

  it("is_open=false の曜日は休業", () => {
    // 2026-07-12 は日曜
    expect(isClosedByBusinessHours("2026-07-12", businessHours)).toBe(true);
  });

  it("行がない曜日は休業として扱う(booking-data と同じ判定)", () => {
    // 2026-07-13 は月曜(行なし)
    expect(isClosedByBusinessHours("2026-07-13", businessHours)).toBe(true);
  });

  it("is_open=true の曜日は営業", () => {
    // 2026-07-18 は土曜
    expect(isClosedByBusinessHours("2026-07-18", businessHours)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. 日付ナビゲーション
// ---------------------------------------------------------------------------

describe("日付ナビゲーション", () => {
  it("日表示ラベルは「2026年7月18日(土)」形式", () => {
    expect(dayNavLabel("2026-07-18")).toBe("2026年7月18日(土)");
    expect(dayNavLabel("2026-08-02")).toBe("2026年8月2日(日)"); // ゼロ埋めなし
  });

  it("週表示ラベルは「2026年7月12日 〜 18日」形式", () => {
    expect(weekNavLabel("2026-07-12")).toBe("2026年7月12日 〜 18日");
  });

  it("週表示ラベルは月またぎで終端に月を含める", () => {
    // 2026-07-26 は日曜、終端は 2026-08-01(土)
    expect(weekNavLabel("2026-07-26")).toBe("2026年7月26日 〜 8月1日");
  });

  it("週表示ラベルは年またぎで終端に年を含める", () => {
    // 2026-12-27 は日曜、終端は 2027-01-02(土)
    expect(weekNavLabel("2026-12-27")).toBe("2026年12月27日 〜 2027年1月2日");
  });

  it("weekStartOf はその週の日曜を返す(日曜自身はそのまま)", () => {
    expect(weekStartOf("2026-07-18")).toBe("2026-07-12"); // 土曜 → 同週日曜
    expect(weekStartOf("2026-07-12")).toBe("2026-07-12"); // 日曜自身
    expect(weekStartOf("2026-08-01")).toBe("2026-07-26"); // 月またぎの週境界
  });

  it("前後の日・週へ移動できる(月またぎ含む)", () => {
    expect(moveDay("2026-07-18", 1)).toBe("2026-07-19");
    expect(moveDay("2026-08-01", -1)).toBe("2026-07-31");
    expect(moveWeek("2026-07-12", 1)).toBe("2026-07-19");
    expect(moveWeek("2026-07-05", -1)).toBe("2026-06-28");
  });

  it("今日判定はJSTの暦日で行う(UTC 15:00 が日付の境界)", () => {
    // UTC 7/17 14:59:59 = JST 7/17 23:59:59
    expect(isJstToday("2026-07-17", new Date("2026-07-17T14:59:59Z"))).toBe(
      true,
    );
    expect(isJstToday("2026-07-18", new Date("2026-07-17T14:59:59Z"))).toBe(
      false,
    );
    // UTC 7/17 15:00:00 = JST 7/18 00:00:00
    expect(isJstToday("2026-07-18", new Date("2026-07-17T15:00:00Z"))).toBe(
      true,
    );
    expect(isJstToday("2026-07-17", new Date("2026-07-17T15:00:00Z"))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. 代行登録の空き判定メッセージ
// ---------------------------------------------------------------------------

describe("slotAvailabilityMessage: 代行登録の空き判定メッセージ", () => {
  const slots: Slot[] = [
    { start: jstDateTime("2026-07-18", "11:00"), status: "available" },
    { start: jstDateTime("2026-07-18", "14:00"), status: "taken" },
  ];
  // すべての枠より前(=過去判定に引っかからない)基準時刻
  const before = jstDateTime("2026-07-18", "08:00");

  it("空いている枠は available・canRegister:true・確保分数入りメッセージ", () => {
    expect(
      slotAvailabilityMessage({
        slots,
        start: jstDateTime("2026-07-18", "11:00"),
        totalDurationMinutes: 150,
        now: before,
        isClosed: false,
      }),
    ).toEqual({
      status: "available",
      canRegister: true,
      message: "この枠は空いています。150分確保できます。",
    });
  });

  it("確保できる分数は選択メニューの合計所要分", () => {
    expect(
      slotAvailabilityMessage({
        slots,
        start: jstDateTime("2026-07-18", "11:00"),
        totalDurationMinutes: 60,
        now: before,
        isClosed: false,
      }).message,
    ).toBe("この枠は空いています。60分確保できます。");
  });

  it("開始が現在より前(厳密に過去)なら past・canRegister:false・登録不可メッセージ", () => {
    expect(
      slotAvailabilityMessage({
        slots,
        start: jstDateTime("2026-07-18", "11:00"),
        totalDurationMinutes: 150,
        now: jstDateTime("2026-07-18", "11:01"),
        isClosed: false,
      }),
    ).toEqual({
      status: "past",
      canRegister: false,
      message: "過去の時間は登録できません",
    });
  });

  it("開始ちょうど(start===now)は過去扱いせず、空きなら available", () => {
    expect(
      slotAvailabilityMessage({
        slots,
        start: jstDateTime("2026-07-18", "11:00"),
        totalDurationMinutes: 150,
        now: jstDateTime("2026-07-18", "11:00"),
        isClosed: false,
      }).status,
    ).toBe("available");
  });

  it("定休日(isClosed)は closed・canRegister:false・登録不可メッセージ(過去の次に優先)", () => {
    expect(
      slotAvailabilityMessage({
        slots,
        start: jstDateTime("2026-07-18", "11:00"),
        totalDurationMinutes: 150,
        now: before,
        isClosed: true,
      }),
    ).toEqual({
      status: "closed",
      canRegister: false,
      message: "定休日は登録できません",
    });
  });

  it("過去は定休日より優先する(start<now なら isClosed でも past)", () => {
    expect(
      slotAvailabilityMessage({
        slots,
        start: jstDateTime("2026-07-18", "11:00"),
        totalDurationMinutes: 150,
        now: jstDateTime("2026-07-18", "11:01"),
        isClosed: true,
      }).status,
    ).toBe("past");
  });

  it("定休日は空き枠(available候補)であっても closed を優先する", () => {
    // 11:00 は available 枠だが、定休日なら登録させない
    expect(
      slotAvailabilityMessage({
        slots,
        start: jstDateTime("2026-07-18", "11:00"),
        totalDurationMinutes: 150,
        now: before,
        isClosed: true,
      }).status,
    ).toBe("closed");
  });

  it("既存予約と重なる枠(taken)は unavailable だが canRegister:true(最終判定はEXCLUDE制約)", () => {
    const result = slotAvailabilityMessage({
      slots,
      start: jstDateTime("2026-07-18", "14:00"),
      totalDurationMinutes: 150,
      now: before,
      isClosed: false,
    });
    expect(result.status).toBe("unavailable");
    expect(result.canRegister).toBe(true);
    expect(result.message).not.toBe("この枠は埋まっています");
  });

  it("候補にない時刻(休憩・勤務外・閉店までに収まらない=slot無し)は unavailable・canRegister:true(上書き可)", () => {
    const result = slotAvailabilityMessage({
      slots,
      start: jstDateTime("2026-07-18", "18:30"),
      totalDurationMinutes: 150,
      now: before,
      isClosed: false,
    });
    expect(result.status).toBe("unavailable");
    expect(result.canRegister).toBe(true);
    // 「埋まっています」と断定しない(休憩・勤務時間外の上書き登録を許すため)
    expect(result.message).not.toBe("この枠は埋まっています");
  });
});

// ---------------------------------------------------------------------------
// 5. 予約リスト表示(スマホ)の整形
// ---------------------------------------------------------------------------

describe("buildReservationListItems: 予約リスト表示(スマホ)の整形", () => {
  const staffNames = [
    { id: "tanaka", name: "田中" },
    { id: "sato", name: "佐藤" },
  ];

  it("時刻・客名・「カット + カラー / 田中」・「〜14:00 ・ ¥11,550」に整形する", () => {
    const items = buildReservationListItems(
      [
        booking({
          id: "b2",
          staffId: "tanaka",
          start: "11:00",
          end: "14:00",
          customerName: "山田",
          menus: [cut, color],
        }),
      ],
      staffNames,
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b2");
    expect(items[0].timeLabel).toBe("11:00");
    expect(items[0].customerLabel).toBe("山田様");
    expect(items[0].menuStaffLabel).toBe("カット + カラー / 田中");
    expect(items[0].endPriceLabel).toBe("〜14:00 ・ ¥11,550");
  });

  it("開始時刻順に並べ、ブロック(kind=block)は除外する", () => {
    const items = buildReservationListItems(
      [
        booking({
          id: "later",
          staffId: "sato",
          start: "10:00",
          end: "12:00",
          customerName: "鈴木",
          menus: [perm],
        }),
        block({ id: "blk", staffId: "tanaka", start: "12:00", end: "13:00" }),
        booking({
          id: "first",
          staffId: "tanaka",
          start: "09:30",
          end: "10:30",
          customerName: "佐々木",
          menus: [cut],
        }),
      ],
      staffNames,
    );
    expect(items.map((i) => i.id)).toEqual(["first", "later"]);
    expect(items[0].menuStaffLabel).toBe("カット / 田中");
    expect(items[1].menuStaffLabel).toBe("パーマ / 佐藤");
  });

  it("開始時刻(start)を保持する(選択状態などUI側の判定に使う)", () => {
    const items = buildReservationListItems(
      [
        booking({
          id: "b1",
          staffId: "tanaka",
          start: "09:30",
          end: "10:30",
          customerName: "佐々木",
          menus: [cut],
        }),
      ],
      staffNames,
    );
    expect(items[0].start).toEqual(jstDateTime("2026-07-18", "09:30"));
  });
});

// ---------------------------------------------------------------------------
// 予約詳細ダイアログ(モックC)の整形
// ---------------------------------------------------------------------------

describe("buildReservationDetailLabels(予約詳細の日時・担当/メニュー整形)", () => {
  it("日時・担当を「7月18日(土)11:00〜 田中」形式にする", () => {
    const labels = buildReservationDetailLabels({
      start: jstDateTime("2026-07-18", "11:00"),
      staffName: "田中",
      menus: [cut, color],
    });
    expect(labels.dateTimeStaffLabel).toBe("7月18日(土)11:00〜 田中");
  });

  it("メニューを「名前(合計所要分) 合計金額」形式にする(スナップショット合計)", () => {
    const labels = buildReservationDetailLabels({
      start: jstDateTime("2026-07-18", "11:00"),
      staffName: "田中",
      menus: [cut, color], // 60+90=150分 / 4950+6600=11550円
    });
    expect(labels.menuLabel).toBe("カット + カラー(150分) ¥11,550");
  });

  it("メニュー1件でも所要分と金額を表示する", () => {
    const labels = buildReservationDetailLabels({
      start: jstDateTime("2026-07-18", "09:30"),
      staffName: "佐藤",
      menus: [cut], // 60分 / 4950円
    });
    expect(labels.menuLabel).toBe("カット(60分) ¥4,950");
    expect(labels.dateTimeStaffLabel).toBe("7月18日(土)9:30〜 佐藤");
  });
});

// ---------------------------------------------------------------------------
// buildProxySlotOptions(代行登録の「その日の空き時間」一覧)
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
