import { describe, expect, it } from "vitest";

import type { BusinessDay } from "./availability";
import {
  makeBusinessDayOf,
  makeIsClosedDay,
  type ClosureRules,
} from "./closures";

import {
  buildDayTimeline,
  buildReservationDetailLabels,
  buildReservationListItems,
  buildWeekView,
  clampDialogPosition,
  dayNavLabel,
  dialogInitialX,
  formDialogInitialX,
  isJstToday,
  moveDay,
  moveWeek,
  shouldFollowDate,
  timeFromTimelineRatio,
  weekItemTooltip,
  weekNavLabel,
  weekStartOf,
  weekdayLabel,
  type AdminCalendarItem,
} from "./admin-calendar";
import { jstDateTime } from "./jst";

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

/**
 * 週表示に渡す businessDayOf を business_hours の行から組む
 * (page.tsx と同じ組み方。休業日ルールを足したいときは extra を渡す)。
 * 本体の closures.ts の weeklyBusinessDayOf(曜日の営業時間を返す)とは別物。
 */
function businessDayOfFromWeekly(
  businessHours: Array<{ weekday: number } & BusinessDay>,
  extra: Partial<ClosureRules> = {},
): (date: string) => BusinessDay {
  return makeBusinessDayOf({
    rules: {
      businessHours,
      nthWeekdayClosures: [],
      closeOnHolidays: false,
      overrides: [],
      ...extra,
    },
    weeklyBusinessHours: businessHours,
  });
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

  it("ラベルは「9:30 佐々木様」形式。60分は所要分を省略し料金も出さない(3行入らない)", () => {
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

  it("複数メニューは「カット + カラー(150分)」形式で、150分なら料金も表示", () => {
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

  it("90分でも料金を表示する(カード高さに3行が収まるため)", () => {
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "b4",
          staffId: "tanaka",
          start: "11:00",
          end: "12:30",
          customerName: "高橋",
          menus: [color],
        }),
      ],
    });
    const placed = timeline.columns[0].blocks.find((b) => b.id === "b4");
    expect(placed?.menuLabel).toBe("カラー(90分)");
    expect(placed?.priceLabel).toBe("¥6,600");
  });

  it("120分でも所要分と料金の両方を表示する", () => {
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
    expect(placed?.priceLabel).toBe("¥9,900");
  });

  it("料金表示の境界: 70分ちょうどは出し、69分では出さない", () => {
    const treatment = {
      menuName: "トリートメント",
      price: 3300,
      durationMinutes: 70,
    };
    const timeline = buildDayTimeline({
      ...base,
      items: [
        booking({
          id: "just",
          staffId: "tanaka",
          start: "09:00",
          end: "10:10", // 70分
          customerName: "境界",
          menus: [treatment],
        }),
        booking({
          id: "under",
          staffId: "sato",
          start: "09:00",
          end: "10:09", // 69分
          customerName: "境界未満",
          menus: [treatment],
        }),
      ],
    });
    expect(
      timeline.columns[0].blocks.find((b) => b.id === "just")?.priceLabel,
    ).toBe("¥3,300");
    expect(
      timeline.columns[1].blocks.find((b) => b.id === "under")?.priceLabel,
    ).toBeNull();
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
  const isClosedDay = makeIsClosedDay({
    businessHours,
    nthWeekdayClosures: [],
    closeOnHolidays: false,
    overrides: [],
  });
  const businessDayOf = businessDayOfFromWeekly(businessHours);
  const weekStart = "2026-07-12"; // 日曜

  it("週の開始(日曜)から7日分を日別にグルーピングする", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
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
      businessDayOf,
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
      businessDayOf,
      items: [],
      // 例: 2026-07-15 を臨時休業にするルール
      isClosedDay: (date) => date === "2026-07-15" || isClosedDay(date),
    });
    expect(view.days[3].isClosed).toBe(true);
  });

  it("時間軸は週内の営業時間の最小開店〜最大閉店(土曜の9:00〜19:00)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [],
      isClosedDay,
    });
    expect(view.ticks[0]).toBe("9:00");
    expect(view.ticks[view.ticks.length - 1]).toBe("19:00");
  });

  it("週の目盛りにも時間軸上の位置(top%)が付く", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
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
      businessDayOf,
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
      businessDayOf,
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
      businessDayOf,
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
      businessDayOf,
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
      businessDayOf,
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
      businessDayOf,
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

  it("ツールチップ用に、高さに関わらず全メニュー名(menuNames)を持つ", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [
        // 60分以下なのでカード上の menuLabel は省略されるが、menuNames は残る
        booking({
          id: "short",
          staffId: "tanaka",
          date: "2026-07-14",
          start: "11:00",
          end: "12:00",
          customerName: "森",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.days[2].items[0].menuLabel).toBeNull();
    expect(view.days[2].items[0].menuNames).toBe("カット");
  });
});

// ---------------------------------------------------------------------------
// 2-1b. 曜日ごとに閉店時刻が違う週(特性化 → 営業時間外の帯)
// ---------------------------------------------------------------------------

describe("buildWeekView: 曜日ごとに閉店時刻が違う週", () => {
  // 水曜だけ21時まで営業し、他の曜日は19時に閉まる(M4bで曜日ごとの営業時間を
  // 編集できるようにして初めて作れる設定)。日曜は定休。
  const businessHours = [
    { weekday: 0, isOpen: false, openTime: null, closeTime: null },
    ...[1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: true,
      openTime: "09:00:00",
      closeTime: weekday === 3 ? "21:00:00" : "19:00:00",
    })),
  ];
  const isClosedDay = makeIsClosedDay({
    businessHours,
    nthWeekdayClosures: [],
    closeOnHolidays: false,
    overrides: [],
  });
  const businessDayOf = businessDayOfFromWeekly(businessHours);
  const weekStart = "2026-07-12"; // 日曜(水曜は 2026-07-15)

  const base = { weekStart, items: [], isClosedDay, businessDayOf };

  it("軸は週内の最小開店〜最大閉店(9:00〜21:00)のまま狭めない", () => {
    const view = buildWeekView(base);
    expect(view.axis).toEqual({ openMinutes: 540, closeMinutes: 1260 });
  });

  it("軸を狭めないので、水曜の20:00〜21:00の予約も軸に収まる", () => {
    const view = buildWeekView({
      ...base,
      items: [
        booking({
          id: "wed-late",
          staffId: "tanaka",
          date: "2026-07-15",
          start: "20:00",
          end: "21:00",
          customerName: "遅番",
          menus: [cut],
        }),
      ],
    });
    const wed = view.days[3].items;
    expect(wed.map((i) => i.id)).toEqual(["wed-late"]);
    // 軸 9:00〜21:00(720分)基準: 20:00 = 660分 → 91.67%、60分 → 8.33%
    expect(wed[0].topPercent).toBeCloseTo((660 * 100) / 720);
    expect(wed[0].heightPercent).toBeCloseTo((60 * 100) / 720);
  });

  it("他の曜日より早く閉まる日は、閉店後(19:00〜21:00)に営業時間外の帯が出る", () => {
    const view = buildWeekView(base);
    // 月曜: 9:00〜19:00 営業 → 19:00(600分)から軸の下端まで
    expect(view.days[1].offHoursBands).toEqual([
      { topPercent: (600 * 100) / 720, heightPercent: (120 * 100) / 720 },
    ]);
  });

  it("軸と営業時間が一致する日(水曜)は帯が出ない", () => {
    const view = buildWeekView(base);
    expect(view.days[3].offHoursBands).toEqual([]);
  });

  it("定休日は列全体が定休日の表現になるので帯を重ねない", () => {
    const view = buildWeekView(base);
    expect(view.days[0].isClosed).toBe(true);
    expect(view.days[0].offHoursBands).toEqual([]);
  });
});

describe("buildWeekView: 営業時間外の帯(offHoursBands)", () => {
  const isClosedDay = (date: string) => date === "2026-07-12"; // 日曜だけ定休
  const weekStart = "2026-07-12";

  /** 曜日ごとの営業時間を組み立てる(日曜は定休) */
  function hoursOf(
    byWeekday: Record<number, { open: string; close: string } | null>,
  ) {
    return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
      const row = byWeekday[weekday] ?? null;
      return row === null
        ? { weekday, isOpen: false, openTime: null, closeTime: null }
        : {
            weekday,
            isOpen: true,
            openTime: `${row.open}:00`,
            closeTime: `${row.close}:00`,
          };
    });
  }

  it("他の曜日より遅く開く日は、開店前に帯が出る", () => {
    // 月曜だけ11:00開店、他は9:00開店(軸は 9:00〜19:00 = 600分)
    const view = buildWeekView({
      weekStart,
      businessDayOf: businessDayOfFromWeekly(
        hoursOf({
          1: { open: "11", close: "19" },
          2: { open: "09", close: "19" },
          3: { open: "09", close: "19" },
          4: { open: "09", close: "19" },
          5: { open: "09", close: "19" },
          6: { open: "09", close: "19" },
        }),
      ),
      items: [],
      isClosedDay,
    });
    expect(view.axis).toEqual({ openMinutes: 540, closeMinutes: 1140 });
    // 9:00〜11:00(120分)が開店前の帯
    expect(view.days[1].offHoursBands).toEqual([
      { topPercent: 0, heightPercent: (120 * 100) / 600 },
    ]);
  });

  it("開店が遅く閉店も早い日は、開店前・閉店後の2本が出る", () => {
    // 軸 9:00〜21:00(720分)。火曜だけ 11:00〜19:00
    const view = buildWeekView({
      weekStart,
      businessDayOf: businessDayOfFromWeekly(
        hoursOf({
          1: { open: "09", close: "21" },
          2: { open: "11", close: "19" },
          3: { open: "09", close: "21" },
          4: { open: "09", close: "21" },
          5: { open: "09", close: "21" },
          6: { open: "09", close: "21" },
        }),
      ),
      items: [],
      isClosedDay,
    });
    expect(view.days[2].offHoursBands).toEqual([
      { topPercent: 0, heightPercent: (120 * 100) / 720 },
      { topPercent: (600 * 100) / 720, heightPercent: (120 * 100) / 720 },
    ]);
  });

  it("営業時間の行が無い曜日は休業扱いなので帯を出さない(定休日と同じ扱い)", () => {
    // 木曜(weekday=4)の行を落とす
    const businessHours = hoursOf({
      1: { open: "09", close: "19" },
      2: { open: "09", close: "19" },
      3: { open: "09", close: "21" },
      5: { open: "09", close: "19" },
      6: { open: "09", close: "19" },
    }).filter((row) => row.weekday !== 4);
    const view = buildWeekView({
      weekStart,
      businessDayOf: businessDayOfFromWeekly(businessHours),
      items: [],
      // 行が無い曜日の休業判定は呼び出し側(closures.ts)が持つ
      isClosedDay: (date) => date === "2026-07-12" || date === "2026-07-16",
    });
    expect(view.days[4].isClosed).toBe(true);
    expect(view.days[4].offHoursBands).toEqual([]);
  });

  it("予約で軸が広がった場合も、帯は軸基準で正しい位置に出る", () => {
    // 全曜日 9:00〜19:00。土曜 20:00 終了の予約で軸が 9:00〜20:00(660分)に広がる
    const view = buildWeekView({
      weekStart,
      businessDayOf: businessDayOfFromWeekly(
        hoursOf({
          1: { open: "09", close: "19" },
          2: { open: "09", close: "19" },
          3: { open: "09", close: "19" },
          4: { open: "09", close: "19" },
          5: { open: "09", close: "19" },
          6: { open: "09", close: "19" },
        }),
      ),
      items: [
        booking({
          id: "sat-late",
          staffId: "tanaka",
          date: "2026-07-18",
          start: "19:00",
          end: "20:00",
          customerName: "居残り",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.axis).toEqual({ openMinutes: 540, closeMinutes: 1200 });
    // どの営業日も 19:00(600分)から軸の下端(660分)までが営業時間外
    const expected = [
      { topPercent: (600 * 100) / 660, heightPercent: (60 * 100) / 660 },
    ];
    expect(view.days[1].offHoursBands).toEqual(expected);
    // 予約が載っている土曜も帯は同じ(予約は帯の上に描かれる)
    expect(view.days[6].offHoursBands).toEqual(expected);
    expect(view.days[6].items.map((i) => i.id)).toEqual(["sat-late"]);
  });

  it("軸が無い週(営業日も予約も無い)は帯も空になる", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf: businessDayOfFromWeekly(hoursOf({})),
      items: [],
      isClosedDay: () => true,
    });
    expect(view.axis).toBeNull();
    expect(view.days.every((d) => d.offHoursBands.length === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2-1c. 臨時営業・短縮営業(date_overrides の時刻)と軸・帯
// ---------------------------------------------------------------------------

describe("buildWeekView: 臨時営業・短縮営業の日(実効営業時間)", () => {
  // 月曜定休。他の曜日は 9:00〜21:00。月曜(2026-07-13)に上書きを当てる
  const weekStart = "2026-07-12"; // 日曜
  const businessHours = [
    { weekday: 0, isOpen: false, openTime: null, closeTime: null },
    { weekday: 1, isOpen: false, openTime: null, closeTime: null }, // 月曜定休
    ...[2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: true,
      openTime: "09:00:00",
      closeTime: "21:00:00",
    })),
  ];

  /** business_hours + 上書きから、週表示に渡す2つの関数を組む(page.tsx と同じ組み方) */
  function inputsOf(overrides: ClosureRules["overrides"]) {
    const rules: ClosureRules = {
      businessHours,
      nthWeekdayClosures: [],
      closeOnHolidays: false,
      overrides,
    };
    return {
      isClosedDay: makeIsClosedDay(rules),
      businessDayOf: makeBusinessDayOf({
        rules,
        weeklyBusinessHours: businessHours,
      }),
    };
  }

  it("臨時休業の日は定休日と同じ扱い(帯を重ねない)", () => {
    const view = buildWeekView({
      weekStart,
      items: [],
      ...inputsOf([
        {
          startDate: "2026-07-15",
          endDate: "2026-07-15",
          isOpen: false,
          label: "臨時休業",
          openTime: null,
          closeTime: null,
        },
      ]),
    });
    expect(view.days[3].isClosed).toBe(true);
    expect(view.days[3].offHoursBands).toEqual([]);
  });

  it("定休曜日の臨時営業: その日は定休日にならず、営業時間の外側に2本の帯が出る", () => {
    const view = buildWeekView({
      weekStart,
      items: [],
      ...inputsOf([
        {
          startDate: "2026-07-13",
          endDate: "2026-07-13",
          isOpen: true,
          label: "臨時営業",
          openTime: "10:00:00",
          closeTime: "15:00:00",
        },
      ]),
    });
    // 軸は 9:00〜21:00(720分)。月曜は 10:00〜15:00 だけ営業
    expect(view.axis).toEqual({ openMinutes: 540, closeMinutes: 1260 });
    expect(view.days[1].isClosed).toBe(false);
    expect(view.days[1].offHoursBands).toEqual([
      // 9:00〜10:00
      { topPercent: 0, heightPercent: (60 * 100) / 720 },
      // 15:00〜21:00
      { topPercent: (360 * 100) / 720, heightPercent: (360 * 100) / 720 },
    ]);
  });

  it("営業曜日の短縮営業: 狭まった分が帯になる", () => {
    const view = buildWeekView({
      weekStart,
      items: [],
      // 火曜(9:00〜21:00 営業)を 10:00〜15:00 に短縮する
      ...inputsOf([
        {
          startDate: "2026-07-14",
          endDate: "2026-07-14",
          isOpen: true,
          label: null,
          openTime: "10:00:00",
          closeTime: "15:00:00",
        },
      ]),
    });
    expect(view.days[2].offHoursBands).toEqual([
      { topPercent: 0, heightPercent: (60 * 100) / 720 },
      { topPercent: (360 * 100) / 720, heightPercent: (360 * 100) / 720 },
    ]);
    // 上書きのない水曜は 9:00〜21:00 のままなので帯なし
    expect(view.days[3].offHoursBands).toEqual([]);
  });

  it("時刻なしの臨時営業(祝日の打ち消し)は、その曜日の営業時間どおりの帯になる", () => {
    const view = buildWeekView({
      weekStart,
      items: [],
      ...inputsOf([
        // 祝日を休業にする設定を打ち消すだけの上書き(時刻なし)。
        // 対象は営業曜日の木曜なので、その曜日の 9:00〜21:00 で営業する
        {
          startDate: "2026-07-16",
          endDate: "2026-07-16",
          isOpen: true,
          label: null,
          openTime: null,
          closeTime: null,
        },
      ]),
    });
    expect(view.days[4].isClosed).toBe(false);
    expect(view.days[4].offHoursBands).toEqual([]);
  });

  it("営業曜日の範囲外に臨時営業を置くと、その時間まで軸が広がる", () => {
    const view = buildWeekView({
      weekStart,
      // 軸が広がらないと描けない、臨時営業中の予約
      items: [
        booking({
          id: "night",
          staffId: "tanaka",
          date: "2026-07-13",
          start: "21:00",
          end: "22:00",
          customerName: "深夜",
          menus: [cut],
        }),
      ],
      ...inputsOf([
        {
          startDate: "2026-07-13",
          endDate: "2026-07-13",
          isOpen: true,
          label: "夜間営業",
          openTime: "21:00:00",
          closeTime: "23:00:00",
        },
      ]),
    });
    // 9:00〜23:00(840分)。月曜の営業時間が軸に入る
    expect(view.axis).toEqual({ openMinutes: 540, closeMinutes: 1380 });
    expect(view.days[1].items.map((i) => i.id)).toEqual(["night"]);
    // 月曜は 21:00 までが営業時間外
    expect(view.days[1].offHoursBands).toEqual([
      { topPercent: 0, heightPercent: (720 * 100) / 840 },
    ]);
  });

  it("休業ではないのに営業時間が無い日(定休曜日に時刻なしの臨時営業が残った状態)は軸全体を帯にする", () => {
    // validateDateOverride はこの登録を弾くが、登録後に business_hours の
    // その曜日を定休へ変えると作れてしまう(isClosedDay=false なのに
    // 営業時間が決まらない)。枠は1つも開かないので全体を営業時間外と示す
    const view = buildWeekView({
      weekStart,
      items: [],
      ...inputsOf([
        {
          startDate: "2026-07-13", // 月曜(定休)
          endDate: "2026-07-13",
          isOpen: true,
          label: null,
          openTime: null,
          closeTime: null,
        },
      ]),
    });
    expect(view.days[1].isClosed).toBe(false);
    expect(view.days[1].offHoursBands).toEqual([
      { topPercent: 0, heightPercent: 100 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2-2. 週表示の重なりレーン分割
// ---------------------------------------------------------------------------

describe("buildWeekView: 重なる予約のレーン分割", () => {
  // 週表示は1つの日付列に全スタッフの予約を並べるため、別スタッフ同士の
  // 予約が同じ時間帯で重なる。横位置(left%/width%)で並べて両方見せる。
  const businessHours = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    isOpen: true,
    openTime: "09:00:00",
    closeTime: "19:00:00",
  }));
  const isClosedDay = () => false;
  const businessDayOf = businessDayOfFromWeekly(businessHours);
  const weekStart = "2026-07-12"; // 日曜
  const date = "2026-07-14"; // 火曜(days[2])

  /** 火曜の予約だけを渡して、その日のアイテムを id 順に引けるようにする */
  function tuesdayItems(
    ranges: Array<{ id: string; start: string; end: string }>,
  ) {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: ranges.map((range, index) =>
        booking({
          id: range.id,
          // 週表示は全スタッフを1列に並べる。重なるのは必ず別スタッフ同士
          // (同一スタッフの重複はEXCLUDE制約(ADR-004)で起きない)
          staffId: `staff-${index}`,
          date,
          start: range.start,
          end: range.end,
          customerName: range.id,
          menus: [cut],
        }),
      ),
      isClosedDay,
    });
    return new Map(view.days[2].items.map((item) => [item.id, item]));
  }

  it("重なりが無ければ横幅いっぱい(left 0% / width 100%)", () => {
    const items = tuesdayItems([
      { id: "a", start: "10:00", end: "11:00" },
      { id: "b", start: "14:00", end: "15:00" },
    ]);
    expect(items.get("a")).toMatchObject({ leftPercent: 0, widthPercent: 100 });
    expect(items.get("b")).toMatchObject({ leftPercent: 0, widthPercent: 100 });
  });

  it("2件が重なると左右half(width 50%・left 0%と50%)", () => {
    const items = tuesdayItems([
      { id: "a", start: "10:00", end: "11:00" },
      { id: "b", start: "10:30", end: "11:30" },
    ]);
    expect(items.get("a")).toMatchObject({ leftPercent: 0, widthPercent: 50 });
    expect(items.get("b")).toMatchObject({ leftPercent: 50, widthPercent: 50 });
  });

  it("3件が重なると3等分(width 約33.33%・left 0/33.33/66.67%)", () => {
    const items = tuesdayItems([
      { id: "a", start: "10:00", end: "12:00" },
      { id: "b", start: "10:30", end: "12:00" },
      { id: "c", start: "11:00", end: "12:00" },
    ]);
    for (const id of ["a", "b", "c"]) {
      expect(items.get(id)!.widthPercent).toBeCloseTo(100 / 3, 6);
    }
    expect(items.get("a")!.leftPercent).toBeCloseTo(0, 6);
    expect(items.get("b")!.leftPercent).toBeCloseTo(100 / 3, 6);
    expect(items.get("c")!.leftPercent).toBeCloseTo(200 / 3, 6);
  });

  it("接しているだけ(前の終了 == 次の開始)は重なりではない(どちらも100%)", () => {
    const items = tuesdayItems([
      { id: "a", start: "10:00", end: "11:00" },
      { id: "b", start: "11:00", end: "12:00" },
    ]);
    expect(items.get("a")).toMatchObject({ leftPercent: 0, widthPercent: 100 });
    expect(items.get("b")).toMatchObject({ leftPercent: 0, widthPercent: 100 });
  });

  it("連鎖する重なり(A-B と B-C は重なるが A-C は重ならない)は同一クラスタで幅を分け合い、空いたレーンは再利用する", () => {
    const items = tuesdayItems([
      { id: "a", start: "10:00", end: "11:00" },
      { id: "b", start: "10:30", end: "11:30" },
      { id: "c", start: "11:00", end: "12:00" }, // A とは接するだけ
    ]);
    // A-B-C は連鎖でひとつのクラスタ。C は A の終わったレーン0に入るため
    // クラスタのレーン数は2(全員 width 50%)。
    expect(items.get("a")).toMatchObject({ leftPercent: 0, widthPercent: 50 });
    expect(items.get("b")).toMatchObject({ leftPercent: 50, widthPercent: 50 });
    expect(items.get("c")).toMatchObject({ leftPercent: 0, widthPercent: 50 });
  });

  it("別クラスタはそれぞれ独立してレーン数が決まる", () => {
    const items = tuesdayItems([
      // 午前のクラスタ: 3件重なり
      { id: "m1", start: "10:00", end: "12:00" },
      { id: "m2", start: "10:30", end: "12:00" },
      { id: "m3", start: "11:00", end: "12:00" },
      // 午後のクラスタ: 2件重なり(午前とは重ならない)
      { id: "a1", start: "15:00", end: "16:00" },
      { id: "a2", start: "15:30", end: "16:30" },
      // 単独
      { id: "s1", start: "18:00", end: "19:00" },
    ]);
    expect(items.get("m1")!.widthPercent).toBeCloseTo(100 / 3, 6);
    expect(items.get("m3")!.widthPercent).toBeCloseTo(100 / 3, 6);
    expect(items.get("a1")).toMatchObject({ leftPercent: 0, widthPercent: 50 });
    expect(items.get("a2")).toMatchObject({
      leftPercent: 50,
      widthPercent: 50,
    });
    expect(items.get("s1")).toMatchObject({
      leftPercent: 0,
      widthPercent: 100,
    });
  });

  it("開始が同時刻なら終了が早い順に左から並べる(決定的な順序)", () => {
    const items = tuesdayItems([
      { id: "long", start: "10:00", end: "12:00" },
      { id: "short", start: "10:00", end: "11:00" },
    ]);
    expect(items.get("short")!.leftPercent).toBe(0);
    expect(items.get("long")!.leftPercent).toBe(50);
  });

  it("日をまたいで影響しない(別の日の予約とは重なり判定しない)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [
        booking({
          id: "tue",
          staffId: "tanaka",
          date: "2026-07-14",
          start: "10:00",
          end: "11:00",
          customerName: "火",
          menus: [cut],
        }),
        booking({
          id: "wed",
          staffId: "sato",
          date: "2026-07-15",
          start: "10:00",
          end: "11:00",
          customerName: "水",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.days[2].items[0]).toMatchObject({
      leftPercent: 0,
      widthPercent: 100,
    });
    expect(view.days[3].items[0]).toMatchObject({
      leftPercent: 0,
      widthPercent: 100,
    });
  });
});

describe("weekItemTooltip: 週表示カードのツールチップ", () => {
  const item = { titleLabel: "11:00 山田様", menuNames: "カット + カラー" };

  it("開始時刻・客名・メニュー・担当を「 / 」で連ねる", () => {
    expect(weekItemTooltip(item, "田中")).toBe(
      "11:00 山田様 / カット + カラー / 田中",
    );
  });

  it("担当名が引けないときは省く(区切りだけが残らない)", () => {
    expect(weekItemTooltip(item, undefined)).toBe(
      "11:00 山田様 / カット + カラー",
    );
    expect(weekItemTooltip(item, "")).toBe("11:00 山田様 / カット + カラー");
  });

  it("メニュー名が空のときも区切りだけが残らない", () => {
    expect(
      weekItemTooltip({ titleLabel: "11:00 山田様", menuNames: "" }, "田中"),
    ).toBe("11:00 山田様 / 田中");
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

  it("曜日ラベルは日曜「日」〜土曜「土」を返す", () => {
    expect(weekdayLabel("2026-07-12")).toBe("日"); // 日曜
    expect(weekdayLabel("2026-07-18")).toBe("土"); // 土曜
    expect(weekdayLabel("2026-07-15")).toBe("水"); // 平日
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

describe("shouldFollowDate: フォームの日付に背後のカレンダーを追従させるか", () => {
  it("日表示: 表示中と同じ日付なら追従しない", () => {
    expect(
      shouldFollowDate({
        view: "day",
        currentDate: "2026-07-18",
        nextDate: "2026-07-18",
      }),
    ).toBe(false);
  });

  it("日表示: 別の日付なら追従する(同じ週の中でも)", () => {
    // 2026-07-18(土)と 2026-07-15(水)は同じ週だが、日表示では別の画面
    expect(
      shouldFollowDate({
        view: "day",
        currentDate: "2026-07-18",
        nextDate: "2026-07-15",
      }),
    ).toBe(true);
  });

  it("週表示: 同じ週の別の日付なら追従しない(すでに見えている)", () => {
    // どちらも週の始まりは 2026-07-12(日)
    expect(
      shouldFollowDate({
        view: "week",
        currentDate: "2026-07-18",
        nextDate: "2026-07-15",
      }),
    ).toBe(false);
  });

  it("週表示: 別の週なら追従する", () => {
    // 2026-07-18 の週(7/12〜)→ 2026-07-19 の週(7/19〜)。1日違いでも週境界を跨ぐ
    expect(
      shouldFollowDate({
        view: "week",
        currentDate: "2026-07-18",
        nextDate: "2026-07-19",
      }),
    ).toBe(true);
  });

  it("週表示: 月をまたいでも同じ週なら追従しない", () => {
    // 2026-07-26(日)〜 2026-08-01(土)は同じ週
    expect(
      shouldFollowDate({
        view: "week",
        currentDate: "2026-07-26",
        nextDate: "2026-08-01",
      }),
    ).toBe(false);
  });

  it("不正な日付では追従しない(日付入力は入力途中に空文字・不完全な値になる)", () => {
    for (const nextDate of ["", "2026-07", "2026-7-18", "2026-02-30"]) {
      expect(
        shouldFollowDate({
          view: "day",
          currentDate: "2026-07-18",
          nextDate,
        }),
      ).toBe(false);
    }
  });

  it("表示中の日付が不正でも、正しい日付へは追従する", () => {
    expect(
      shouldFollowDate({
        view: "day",
        currentDate: "",
        nextDate: "2026-07-18",
      }),
    ).toBe(true);
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
      requestNote: null,
    });
    expect(labels.dateTimeStaffLabel).toBe("7月18日(土)11:00〜 田中");
  });

  it("メニューを「名前(合計所要分) 合計金額」形式にする(スナップショット合計)", () => {
    const labels = buildReservationDetailLabels({
      start: jstDateTime("2026-07-18", "11:00"),
      staffName: "田中",
      menus: [cut, color], // 60+90=150分 / 4950+6600=11550円
      requestNote: null,
    });
    expect(labels.menuLabel).toBe("カット + カラー(150分) ¥11,550");
  });

  it("メニュー1件でも所要分と金額を表示する", () => {
    const labels = buildReservationDetailLabels({
      start: jstDateTime("2026-07-18", "09:30"),
      staffName: "佐藤",
      menus: [cut], // 60分 / 4950円
      requestNote: null,
    });
    expect(labels.menuLabel).toBe("カット(60分) ¥4,950");
    expect(labels.dateTimeStaffLabel).toBe("7月18日(土)9:30〜 佐藤");
  });
});

describe("buildReservationDetailLabels(予約詳細の「ご要望・ご相談」欄)", () => {
  const base = {
    start: jstDateTime("2026-07-18", "11:00"),
    staffName: "田中",
    menus: [cut],
  };

  it("ご要望が null なら「(なし)」を出し、空として扱う", () => {
    const labels = buildReservationDetailLabels({ ...base, requestNote: null });
    expect(labels.requestNote).toEqual({ text: "(なし)", isEmpty: true });
  });

  it("ご要望が空文字なら「(なし)」を出し、空として扱う", () => {
    const labels = buildReservationDetailLabels({ ...base, requestNote: "" });
    expect(labels.requestNote).toEqual({ text: "(なし)", isEmpty: true });
  });

  it("ご要望が空白・改行だけなら「(なし)」を出し、空として扱う", () => {
    const labels = buildReservationDetailLabels({
      ...base,
      requestNote: " \n\t　",
    });
    expect(labels.requestNote).toEqual({ text: "(なし)", isEmpty: true });
  });

  it("ご要望に本文があればそのまま出す", () => {
    const labels = buildReservationDetailLabels({
      ...base,
      requestNote: "前髪は短めで",
    });
    expect(labels.requestNote).toEqual({
      text: "前髪は短めで",
      isEmpty: false,
    });
  });

  it("本文の前後の空白・途中の改行は削らずにそのまま出す(従来の表示と同じ)", () => {
    const labels = buildReservationDetailLabels({
      ...base,
      requestNote: "  前髪は短めで\n襟足はそのまま\n",
    });
    expect(labels.requestNote).toEqual({
      text: "  前髪は短めで\n襟足はそのまま\n",
      isEmpty: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 7. 空き枠クリック(日表示)→ 代行登録ダイアログ
// ---------------------------------------------------------------------------

describe("buildDayTimeline: 時間軸の分数(axis)", () => {
  const base = {
    date: "2026-07-18",
    businessDay,
    staff,
    workingHours,
  };

  it("営業日は営業時間の開店・閉店を分数で返す(クリック位置→時刻の変換に使う)", () => {
    const timeline = buildDayTimeline({ ...base, items: [] });
    expect(timeline.axis).toEqual({ openMinutes: 540, closeMinutes: 1140 });
  });

  it("休業日でも予約があれば予約の範囲から組んだ軸を返す", () => {
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
    // 9:30〜10:30 → 軸は 9:00〜11:00(正時に丸め)
    expect(timeline.axis).toEqual({ openMinutes: 540, closeMinutes: 660 });
  });

  it("予約のない休業日は軸なし(null。タイムラインを描かないのでクリックもできない)", () => {
    const timeline = buildDayTimeline({
      ...base,
      businessDay: { isOpen: false, openTime: null, closeTime: null },
      items: [],
    });
    expect(timeline.axis).toBeNull();
  });
});

describe("buildWeekView: 時間軸の分数(axis)", () => {
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
  const isClosedDay = makeIsClosedDay({
    businessHours,
    nthWeekdayClosures: [],
    closeOnHolidays: false,
    overrides: [],
  });
  const businessDayOf = businessDayOfFromWeekly(businessHours);
  const weekStart = "2026-07-12"; // 日曜

  it("営業日のある週は最小開店〜最大閉店を分数で返す(クリック位置→時刻の変換に使う)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [],
      isClosedDay,
    });
    expect(view.axis).toEqual({ openMinutes: 540, closeMinutes: 1140 });
  });

  it("週内に営業日が1日もなければ軸なし(null。クリックもできない)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf: businessDayOfFromWeekly(
        businessHours.map((day) => ({
          ...day,
          isOpen: false,
          openTime: null,
          closeTime: null,
        })),
      ),
      items: [],
      isClosedDay: () => true,
    });
    expect(view.axis).toBeNull();
    expect(view.ticks).toEqual([]);
  });

  it("営業時間外の予約を含む週は、その予約を含むところまで軸が広がる", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [
        // 平日営業は 10:00〜18:00 だが、8:00 開始・20:00 終了の予約が軸に入る
        booking({
          id: "early",
          staffId: "tanaka",
          date: "2026-07-13",
          start: "08:00",
          end: "09:00",
          customerName: "早朝",
          menus: [cut],
        }),
        booking({
          id: "late",
          staffId: "sato",
          date: "2026-07-14",
          start: "19:00",
          end: "20:00",
          customerName: "夜間",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.axis).toEqual({ openMinutes: 480, closeMinutes: 1200 });
  });

  it("予約で広げた軸は正時に丸める(開店側は切り下げ・閉店側は切り上げ)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [
        // 8:45 開始 → 8:00 まで切り下げ
        booking({
          id: "early",
          staffId: "tanaka",
          date: "2026-07-13",
          start: "08:45",
          end: "09:15",
          customerName: "早朝",
          menus: [cut],
        }),
        // 19:45 終了 → 20:00 まで切り上げ
        booking({
          id: "late",
          staffId: "sato",
          date: "2026-07-14",
          start: "19:15",
          end: "19:45",
          customerName: "夜間",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    expect(view.axis).toEqual({ openMinutes: 480, closeMinutes: 1200 });
  });

  it("半端な時刻の予約が営業時間の中に収まるなら軸は営業時間のまま(クリック位置が枠の格子とずれない)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [
        booking({
          id: "odd",
          staffId: "tanaka",
          date: "2026-07-14",
          start: "10:15",
          end: "11:15",
          customerName: "半端",
          menus: [cut],
        }),
      ],
      isClosedDay,
    });
    // 土曜 9:00〜19:00 のまま(9:15 始まりの軸にならない)
    expect(view.axis).toEqual({ openMinutes: 540, closeMinutes: 1140 });
    // 軸が正時なら、クリック位置から求まる時刻も枠の格子(9:00・9:30…)に乗る
    expect(
      timeFromTimelineRatio({
        ratio: 0,
        openMinutes: view.axis?.openMinutes ?? -1,
        closeMinutes: view.axis?.closeMinutes ?? -1,
        intervalMinutes: 30,
      }),
    ).toBe("09:00");
  });

  it("営業時間そのものが正時でなければ丸めない(目盛り生成と同じ基準)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf: businessDayOfFromWeekly(
        businessHours.map((day) =>
          day.isOpen
            ? { ...day, openTime: "09:30:00", closeTime: "18:30:00" }
            : day,
        ),
      ),
      items: [],
      isClosedDay,
    });
    expect(view.axis).toEqual({ openMinutes: 570, closeMinutes: 1110 });
    // hourTickMarks と同じく、最初の目盛りは開店の次の正時
    expect(view.ticks[0]).toBe("10:00");
  });

  it("目盛りの先頭・末尾は軸の開店・閉店と同じ時刻を指す(top%の基準が一致する)", () => {
    const view = buildWeekView({
      weekStart,
      businessDayOf,
      items: [],
      isClosedDay,
    });
    // 軸が null なら意図的に一致しない値にして失敗させる
    const axis = view.axis ?? { openMinutes: -1, closeMinutes: -1 };
    expect(view.ticks[0]).toBe(`${axis.openMinutes / 60}:00`);
    expect(view.ticks[view.ticks.length - 1]).toBe(
      `${axis.closeMinutes / 60}:00`,
    );
  });
});

describe("timeFromTimelineRatio: クリック位置から枠の開始時刻を求める", () => {
  // 営業 9:00〜19:00(540〜1140分)を30分刻みで割る想定
  const axis = { openMinutes: 540, closeMinutes: 1140, intervalMinutes: 30 };

  it("先頭(0%)は開店時刻(ゼロ埋めの HH:MM)", () => {
    expect(timeFromTimelineRatio({ ...axis, ratio: 0 })).toBe("09:00");
  });

  it("中間(50%)は軸の中央の枠", () => {
    // 540 + 0.5*600 = 840分 = 14:00
    expect(timeFromTimelineRatio({ ...axis, ratio: 0.5 })).toBe("14:00");
  });

  it("末尾(100%)でも閉店時刻を超えない", () => {
    expect(timeFromTimelineRatio({ ...axis, ratio: 1 })).toBe("19:00");
  });

  it("刻みの途中を押したら切り下げる(10:29相当 → 10:00)", () => {
    // 629分 = 10:29 → (629-540)/600 = 0.148333…
    expect(timeFromTimelineRatio({ ...axis, ratio: (629 - 540) / 600 })).toBe(
      "10:00",
    );
    // 630分 = 10:30 はちょうど刻みの境界
    expect(timeFromTimelineRatio({ ...axis, ratio: (630 - 540) / 600 })).toBe(
      "10:30",
    );
  });

  it("刻みは開店時刻を基準にする(availability.ts の空き枠と同じ基準)", () => {
    // 開店 9:15 の 30分刻み → 9:15, 9:45, …(正時基準ではない)
    expect(
      timeFromTimelineRatio({
        ratio: 0.5,
        openMinutes: 555, // 9:15
        closeMinutes: 615, // 10:15
        intervalMinutes: 30,
      }),
    ).toBe("09:45");
  });

  it("刻みが15分なら15分単位で返す(店舗設定に従う。30分を前提にしない)", () => {
    // 555分 = 9:15
    expect(
      timeFromTimelineRatio({ ...axis, ratio: 0.025, intervalMinutes: 15 }),
    ).toBe("09:15");
  });

  it("範囲外の比率はクランプする(負は開店、1超は閉店側)", () => {
    expect(timeFromTimelineRatio({ ...axis, ratio: -0.5 })).toBe("09:00");
    expect(timeFromTimelineRatio({ ...axis, ratio: 3 })).toBe("19:00");
  });

  it("軸の長さが0以下なら開店時刻を返す(0除算を避ける)", () => {
    expect(
      timeFromTimelineRatio({
        ratio: 0.5,
        openMinutes: 540,
        closeMinutes: 540,
        intervalMinutes: 30,
      }),
    ).toBe("09:00");
  });
});

describe("clampDialogPosition: ダイアログ位置をビューポート内に留める", () => {
  const size = { width: 400, height: 500 };
  const viewport = { viewportWidth: 1280, viewportHeight: 800 };
  const margin = 16;

  it("収まる位置はそのまま返す", () => {
    expect(
      clampDialogPosition({ x: 300, y: 200, ...size, ...viewport, margin }),
    ).toEqual({ x: 300, y: 200 });
  });

  it("左上へはみ出したら余白の位置まで戻す", () => {
    expect(
      clampDialogPosition({ x: -120, y: -80, ...size, ...viewport, margin }),
    ).toEqual({ x: 16, y: 16 });
  });

  it("右下へはみ出したら画面内に収まる位置まで戻す", () => {
    expect(
      clampDialogPosition({ x: 2000, y: 2000, ...size, ...viewport, margin }),
    ).toEqual({
      x: 1280 - 400 - 16, // 864
      y: 800 - 500 - 16, // 284
    });
  });

  it("ダイアログが画面より大きくても破綻しない(余白の位置を優先する)", () => {
    expect(
      clampDialogPosition({
        x: 500,
        y: 500,
        width: 2000,
        height: 2000,
        ...viewport,
        margin,
      }),
    ).toEqual({ x: 16, y: 16 });
  });
});

describe("dialogInitialX: 代行登録ダイアログをクリックした列以外の領域の中央に出す", () => {
  const DIALOG_WIDTH = 416;
  const base = { viewportWidth: 1280, dialogWidth: DIALOG_WIDTH, margin: 16 };
  /** 時間目盛り(w-14 = 56px)の右からスタッフ列グリッドが始まる想定 */
  const grid = { gridLeft: 56, gridRight: 1280 };

  /** 返ったX(左端)からダイアログの中心Xを求める */
  const centerOf = (x: number) => x + DIALOG_WIDTH / 2;

  describe("スタッフ2人(列幅 612px ずつ)", () => {
    const left = { clickedColumnLeft: 56, clickedColumnRight: 668 };
    const right = { clickedColumnLeft: 668, clickedColumnRight: 1280 };

    it("左列をクリックしたらダイアログの中心が右列の中央に来る", () => {
      const x = dialogInitialX({ ...left, ...grid, ...base });
      expect(centerOf(x)).toBe((668 + 1280) / 2); // 974 = 右列の中央
    });

    it("右列をクリックしたらダイアログの中心が左列の中央に来る", () => {
      const x = dialogInitialX({ ...right, ...grid, ...base });
      expect(centerOf(x)).toBe((56 + 668) / 2); // 362 = 左列の中央
    });
  });

  describe("スタッフ3人(列幅 408px ずつ)", () => {
    // col1 [56,464] / col2 [464,872] / col3 [872,1280]
    it("左端の列をクリックしたら広い右側領域(残り2列)の中央に出す", () => {
      const x = dialogInitialX({
        clickedColumnLeft: 56,
        clickedColumnRight: 464,
        ...grid,
        ...base,
      });
      expect(centerOf(x)).toBe((464 + 1280) / 2); // 872
    });

    it("右端の列をクリックしたら広い左側領域(残り2列)の中央に出す", () => {
      const x = dialogInitialX({
        clickedColumnLeft: 872,
        clickedColumnRight: 1280,
        ...grid,
        ...base,
      });
      expect(centerOf(x)).toBe((56 + 872) / 2); // 464
    });
  });

  it("左右の残り領域が同じ幅なら右側を選ぶ(左端の時間目盛りを隠さない側)", () => {
    // グリッド [0,800]、クリック列 [300,500] → 左右とも 300px
    const x = dialogInitialX({
      clickedColumnLeft: 300,
      clickedColumnRight: 500,
      gridLeft: 0,
      gridRight: 800,
      ...base,
    });
    expect(centerOf(x)).toBe((500 + 800) / 2); // 650(左を選ぶなら150になる)
  });

  it("反対側の領域がダイアログより狭いときはビューポート内へクランプする", () => {
    // 画面幅500・グリッド [56,500] の2列。右領域の中央に合わせるとはみ出す
    const x = dialogInitialX({
      clickedColumnLeft: 56,
      clickedColumnRight: 278,
      gridLeft: 56,
      gridRight: 500,
      viewportWidth: 500,
      dialogWidth: DIALOG_WIDTH,
      margin: 16,
    });
    expect(x).toBe(500 - DIALOG_WIDTH - 16); // 68
    expect(x).toBeGreaterThanOrEqual(16);
    expect(x + DIALOG_WIDTH).toBeLessThanOrEqual(500 - 16);
  });

  it("スタッフ1人(反対側の領域がない)でも画面内の妥当な位置に収まる", () => {
    const x = dialogInitialX({
      clickedColumnLeft: 56,
      clickedColumnRight: 1280,
      ...grid,
      ...base,
    });
    expect(x).toBe(1280 - DIALOG_WIDTH - 16); // 848(右余白まで寄る)
  });

  it("ビューポートがダイアログより狭くても左余白に倒す", () => {
    const x = dialogInitialX({
      clickedColumnLeft: 0,
      clickedColumnRight: 200,
      gridLeft: 0,
      gridRight: 400,
      viewportWidth: 400,
      dialogWidth: DIALOG_WIDTH,
      margin: 16,
    });
    expect(x).toBe(16);
  });

  it("列がグリッドをはみ出す不正な計測値でも画面内に収まる", () => {
    const x = dialogInitialX({
      clickedColumnLeft: -500,
      clickedColumnRight: 9999,
      ...grid,
      ...base,
    });
    expect(x).toBeGreaterThanOrEqual(16);
    expect(x).toBeLessThanOrEqual(1280 - DIALOG_WIDTH - 16);
  });
});

describe("formDialogInitialX: 代行登録・変更で同じ初期位置ロジックを使う", () => {
  const DIALOG_WIDTH = 416;
  const base = { viewportWidth: 1280, dialogWidth: DIALOG_WIDTH, margin: 16 };
  /** 時間目盛り(w-14 = 56px)の右からスタッフ列グリッドが始まる想定 */
  const anchor = {
    columnLeft: 56,
    columnRight: 668,
    gridLeft: 56,
    gridRight: 1280,
  };

  it("列の情報があるときは dialogInitialX と同じ位置を返す(登録・変更で同じ)", () => {
    expect(formDialogInitialX({ anchor, ...base })).toBe(
      dialogInitialX({
        clickedColumnLeft: anchor.columnLeft,
        clickedColumnRight: anchor.columnRight,
        gridLeft: anchor.gridLeft,
        gridRight: anchor.gridRight,
        ...base,
      }),
    );
  });

  it("列の情報が無いとき(リストからの選択など)は右端に寄せる", () => {
    expect(formDialogInitialX({ anchor: null, ...base })).toBe(
      1280 - DIALOG_WIDTH - 16, // 848
    );
  });

  it("列の情報が無く、画面がダイアログより狭いときは左余白に倒す", () => {
    expect(
      formDialogInitialX({
        anchor: null,
        viewportWidth: 300,
        dialogWidth: DIALOG_WIDTH,
        margin: 16,
      }),
    ).toBe(16);
  });
});
