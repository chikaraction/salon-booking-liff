import { describe, expect, it } from "vitest";
import {
  type ReminderOutcome,
  type ReminderReservation,
  canSendPush,
  isPushMessageRecorded,
  reminderWindow,
  selectReminderTargets,
  summarizeReminderRun,
} from "./reminders";

/** JSTの壁時計時刻で Date を作る */
const jst = (dateTime: string) => new Date(`${dateTime}+09:00`);

describe("reminderWindow(送ってよい時間帯と翌日の範囲)", () => {
  it("送信時刻ちょうどは送ってよく、翌日(JST)の [0時, 翌々日0時) を返す", () => {
    expect(reminderWindow(jst("2026-10-22T18:00:00"), 18)).toEqual({
      sendable: true,
      start: jst("2026-10-23T00:00:00"),
      endExclusive: jst("2026-10-24T00:00:00"),
    });
  });

  it("送信時刻を過ぎても21時台までは送ってよい(毎時の再試行)", () => {
    expect(reminderWindow(jst("2026-10-22T19:00:00"), 18).sendable).toBe(true);
    expect(reminderWindow(jst("2026-10-22T21:59:59"), 18).sendable).toBe(true);
  });

  it("送信時刻より前は送らない(理由 before_send_hour)", () => {
    expect(reminderWindow(jst("2026-10-22T17:59:59"), 18)).toEqual({
      sendable: false,
      reason: "before_send_hour",
    });
    expect(reminderWindow(jst("2026-10-22T00:00:00"), 18)).toEqual({
      sendable: false,
      reason: "before_send_hour",
    });
  });

  it("22時以降の夜中は送らない(理由 too_late)", () => {
    expect(reminderWindow(jst("2026-10-22T22:00:00"), 18)).toEqual({
      sendable: false,
      reason: "too_late",
    });
    expect(reminderWindow(jst("2026-10-22T23:59:59"), 18)).toEqual({
      sendable: false,
      reason: "too_late",
    });
  });

  it("送信時刻が22時なら22時台だけ送ってよい", () => {
    expect(reminderWindow(jst("2026-10-22T21:00:00"), 22)).toEqual({
      sendable: false,
      reason: "before_send_hour",
    });
    expect(reminderWindow(jst("2026-10-22T22:30:00"), 22).sendable).toBe(true);
    expect(reminderWindow(jst("2026-10-22T23:00:00"), 22)).toEqual({
      sendable: false,
      reason: "too_late",
    });
  });

  it("送信時刻が23時なら23時台だけ送ってよい", () => {
    expect(reminderWindow(jst("2026-10-22T22:59:59"), 23).sendable).toBe(false);
    expect(reminderWindow(jst("2026-10-22T23:00:00"), 23)).toEqual({
      sendable: true,
      start: jst("2026-10-23T00:00:00"),
      endExclusive: jst("2026-10-24T00:00:00"),
    });
  });

  it("送信時刻が0時なら0時〜21時台に送ってよい", () => {
    expect(reminderWindow(jst("2026-10-22T00:00:00"), 0).sendable).toBe(true);
    expect(reminderWindow(jst("2026-10-22T21:00:00"), 0).sendable).toBe(true);
    expect(reminderWindow(jst("2026-10-22T22:00:00"), 0).sendable).toBe(false);
  });

  it("UTCでは前日でもJSTの時で判断する(JST 9時 = UTC 0時)", () => {
    // UTC 2026-10-22T00:00 = JST 2026-10-22 09:00
    expect(reminderWindow(new Date("2026-10-22T00:00:00Z"), 9)).toEqual({
      sendable: true,
      start: jst("2026-10-23T00:00:00"),
      endExclusive: jst("2026-10-24T00:00:00"),
    });
    // UTC 2026-10-21T15:00 = JST 2026-10-22 00:00(送信時刻18時より前)
    expect(reminderWindow(new Date("2026-10-21T15:00:00Z"), 18).sendable).toBe(
      false,
    );
  });

  it("月末の翌日は翌月1日になる", () => {
    expect(reminderWindow(jst("2026-10-31T18:00:00"), 18)).toEqual({
      sendable: true,
      start: jst("2026-11-01T00:00:00"),
      endExclusive: jst("2026-11-02T00:00:00"),
    });
  });

  it("2月末(平年)の翌日は3月1日になる", () => {
    expect(reminderWindow(jst("2027-02-28T18:00:00"), 18)).toMatchObject({
      start: jst("2027-03-01T00:00:00"),
      endExclusive: jst("2027-03-02T00:00:00"),
    });
  });

  it("年末の翌日は翌年1月1日になる", () => {
    expect(reminderWindow(jst("2026-12-31T20:00:00"), 18)).toEqual({
      sendable: true,
      start: jst("2027-01-01T00:00:00"),
      endExclusive: jst("2027-01-02T00:00:00"),
    });
  });
});

describe("selectReminderTargets(リマインドを送る予約の選別)", () => {
  // 2026-10-22 18時の送信で、翌日 10/23 の予約が対象
  const window = {
    start: jst("2026-10-23T00:00:00"),
    endExclusive: jst("2026-10-24T00:00:00"),
  };
  const reminderHour = 18;

  const base: ReminderReservation = {
    id: "r1",
    kind: "booking",
    status: "confirmed",
    startsAt: jst("2026-10-23T10:00:00"),
    createdAt: jst("2026-10-20T12:00:00"),
    lineUserId: "U1",
  };

  const ids = (targets: ReminderReservation[]) => targets.map((r) => r.id);

  it("確定済み・予約・LINEあり・翌日・未送信・送信時刻前に作成なら対象", () => {
    expect(selectReminderTargets([base], [], window, reminderHour)).toEqual([
      base,
    ]);
  });

  it("ブロック(kind が booking 以外)は対象外", () => {
    const block = { ...base, kind: "block" };
    expect(selectReminderTargets([block], [], window, reminderHour)).toEqual(
      [],
    );
  });

  it("確定済み以外(キャンセル済みなど)は対象外", () => {
    const cancelled = { ...base, status: "cancelled" };
    expect(
      selectReminderTargets([cancelled], [], window, reminderHour),
    ).toEqual([]);
  });

  it("LINEのユーザーIDがない(代行登録の電話客)は対象外", () => {
    const phone = { ...base, lineUserId: null };
    expect(selectReminderTargets([phone], [], window, reminderHour)).toEqual(
      [],
    );
  });

  it("空文字のユーザーIDも対象外", () => {
    const empty = { ...base, lineUserId: "" };
    expect(selectReminderTargets([empty], [], window, reminderHour)).toEqual(
      [],
    );
  });

  it("開始が翌日の範囲外(当日・翌々日)は対象外。翌日0時ちょうどは対象", () => {
    const reservations = [
      { ...base, id: "today", startsAt: jst("2026-10-22T23:59:00") },
      { ...base, id: "midnight", startsAt: jst("2026-10-23T00:00:00") },
      { ...base, id: "last", startsAt: jst("2026-10-23T23:59:00") },
      { ...base, id: "dayAfter", startsAt: jst("2026-10-24T00:00:00") },
    ];
    expect(
      ids(selectReminderTargets(reservations, [], window, reminderHour)),
    ).toEqual(["midnight", "last"]);
  });

  it("送信済みの予約IDは対象外", () => {
    const reservations = [base, { ...base, id: "r2" }];
    expect(
      ids(selectReminderTargets(reservations, ["r1"], window, reminderHour)),
    ).toEqual(["r2"]);
  });

  it("送信済みIDは Set でも渡せる", () => {
    expect(
      selectReminderTargets([base], new Set(["r1"]), window, reminderHour),
    ).toEqual([]);
  });

  it("当日の送信時刻ちょうど以降に作成された予約は対象外(直前に確認を受け取っている)", () => {
    const reservations = [
      { ...base, id: "before", createdAt: jst("2026-10-22T17:59:59") },
      { ...base, id: "atHour", createdAt: jst("2026-10-22T18:00:00") },
      { ...base, id: "after", createdAt: jst("2026-10-22T19:30:00") },
    ];
    expect(
      ids(selectReminderTargets(reservations, [], window, reminderHour)),
    ).toEqual(["before"]);
  });

  it("送信時刻の基準は店舗設定の時(9時なら当日9時より前の作成だけ)", () => {
    const reservations = [
      { ...base, id: "early", createdAt: jst("2026-10-22T08:59:00") },
      { ...base, id: "late", createdAt: jst("2026-10-22T09:00:00") },
    ];
    expect(ids(selectReminderTargets(reservations, [], window, 9))).toEqual([
      "early",
    ]);
  });

  it("月をまたぐ翌日でも送信時刻の基準は前日(当日)になる", () => {
    const novWindow = {
      start: jst("2026-11-01T00:00:00"),
      endExclusive: jst("2026-11-02T00:00:00"),
    };
    const reservations = [
      {
        ...base,
        id: "before",
        startsAt: jst("2026-11-01T11:00:00"),
        createdAt: jst("2026-10-31T17:00:00"),
      },
      {
        ...base,
        id: "after",
        startsAt: jst("2026-11-01T12:00:00"),
        createdAt: jst("2026-10-31T18:30:00"),
      },
    ];
    expect(
      ids(selectReminderTargets(reservations, [], novWindow, reminderHour)),
    ).toEqual(["before"]);
  });

  it("開始時刻の早い順に並べる", () => {
    const reservations = [
      { ...base, id: "c", startsAt: jst("2026-10-23T15:00:00") },
      { ...base, id: "a", startsAt: jst("2026-10-23T09:00:00") },
      { ...base, id: "b", startsAt: jst("2026-10-23T11:30:00") },
    ];
    expect(
      ids(selectReminderTargets(reservations, [], window, reminderHour)),
    ).toEqual(["a", "b", "c"]);
  });

  it("入力の配列を並べ替えない", () => {
    const reservations = [
      { ...base, id: "c", startsAt: jst("2026-10-23T15:00:00") },
      { ...base, id: "a", startsAt: jst("2026-10-23T09:00:00") },
    ];
    selectReminderTargets(reservations, [], window, reminderHour);
    expect(ids(reservations)).toEqual(["c", "a"]);
  });
});

describe("canSendPush(今月の無料枠が残っているか)", () => {
  it("無料枠(200通)未満なら送れる", () => {
    expect(canSendPush(0)).toBe(true);
    expect(canSendPush(199)).toBe(true);
  });

  it("200通に達したら送らない", () => {
    expect(canSendPush(200)).toBe(false);
    expect(canSendPush(250)).toBe(false);
  });
});

describe("isPushMessageRecorded(push_messages への記録の結果)", () => {
  it("エラーが無ければ記録できた", () => {
    expect(isPushMessageRecorded(null)).toBe(true);
  });

  it("一意制約違反(23505)は記録済みなので成功扱い(1予約1通の一意インデックス)", () => {
    expect(isPushMessageRecorded("23505")).toBe(true);
  });

  it("それ以外のエラーコードは記録の失敗", () => {
    expect(isPushMessageRecorded("42501")).toBe(false); // permission denied
    expect(isPushMessageRecorded("23503")).toBe(false); // 外部キー違反
    expect(isPushMessageRecorded("")).toBe(false);
  });
});

describe("summarizeReminderRun(1回の実行の集計)", () => {
  it("送れない時間帯なら理由を status にして件数はすべて0", () => {
    expect(summarizeReminderRun("before_send_hour", [])).toEqual({
      status: "before_send_hour",
      sent: 0,
      alreadyAccepted: 0,
      failed: 0,
      skippedByQuota: 0,
    });
    expect(summarizeReminderRun("too_late", []).status).toBe("too_late");
  });

  it("対象がいなければ status は done で件数はすべて0", () => {
    expect(summarizeReminderRun("done", [])).toEqual({
      status: "done",
      sent: 0,
      alreadyAccepted: 0,
      failed: 0,
      skippedByQuota: 0,
    });
  });

  it("1件ごとの結果を種類別に数える", () => {
    const outcomes: ReminderOutcome[] = [
      "sent",
      "sent",
      "alreadyAccepted",
      "failed",
      "skippedByQuota",
      "skippedByQuota",
      "skippedByQuota",
    ];
    expect(summarizeReminderRun("done", outcomes)).toEqual({
      status: "done",
      sent: 2,
      alreadyAccepted: 1,
      failed: 1,
      skippedByQuota: 3,
    });
  });
});
