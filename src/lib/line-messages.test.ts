import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_TRIGGER_TEXTS,
  buildBookingConfirmationText,
  buildReminderText,
  isConfirmationTrigger,
  myPageUrl,
} from "./line-messages";

// 店舗固有の値はテスト内だけに置く(ADR-007)
const MY_PAGE_URL = "https://liff.line.me/1234567890-abcdefgh/my";

const reservation = {
  // JST 2026-07-18(土)11:00
  start: new Date("2026-07-18T02:00:00Z"),
  staffName: "田中",
  menus: [
    { menuName: "カット", price: 4950, durationMinutes: 60 },
    { menuName: "カラー", price: 6600, durationMinutes: 90 },
  ],
};

describe("myPageUrl(マイ予約のLIFF URL)", () => {
  it("LIFF ID から https://liff.line.me/{id}/my を作る", () => {
    expect(myPageUrl("1234567890-abcdefgh")).toBe(MY_PAGE_URL);
  });
});

describe("buildBookingConfirmationText(予約確認の応答)", () => {
  it("新規の予約は設計文書「文面」のとおりの全文になる", () => {
    expect(
      buildBookingConfirmationText({
        kind: "new",
        ...reservation,
        salonName: "ヘアサロン テスト",
        myPageUrl: MY_PAGE_URL,
      }),
    ).toBe(
      [
        "ご予約ありがとうございます。",
        "以下の内容で承りました。",
        "",
        "日時: 7月18日(土)11:00〜",
        "メニュー: カット + カラー",
        "担当: 田中",
        "合計: ¥11,550(約150分)",
        "",
        "変更・キャンセルはリッチメニューの「マイ予約」からどうぞ。",
        MY_PAGE_URL,
        "ヘアサロン テスト",
      ].join("\n"),
    );
  });

  it("予約の変更は冒頭だけが変わり、予約内容以降は新規と同じ", () => {
    const text = buildBookingConfirmationText({
      kind: "change",
      ...reservation,
      salonName: "ヘアサロン テスト",
      myPageUrl: MY_PAGE_URL,
    });
    const lines = text.split("\n");
    expect(lines.slice(0, 2)).toEqual([
      "ご予約の変更を承りました。",
      "変更後の内容は以下のとおりです。",
    ]);
    expect(lines.slice(2).join("\n")).toBe(
      buildBookingConfirmationText({
        kind: "new",
        ...reservation,
        salonName: "ヘアサロン テスト",
        myPageUrl: MY_PAGE_URL,
      })
        .split("\n")
        .slice(2)
        .join("\n"),
    );
  });

  it("メニューが1件なら結合記号なし、合計はそのメニューの料金・所要時間", () => {
    const text = buildBookingConfirmationText({
      kind: "new",
      ...reservation,
      menus: [{ menuName: "カット", price: 4950, durationMinutes: 60 }],
      salonName: "ヘアサロン テスト",
      myPageUrl: MY_PAGE_URL,
    });
    expect(text).toContain("\nメニュー: カット\n");
    expect(text).toContain("\n合計: ¥4,950(約60分)\n");
  });

  it("メニューが3件以上でもすべて結合し、料金・所要時間を合算する", () => {
    const text = buildBookingConfirmationText({
      kind: "new",
      ...reservation,
      menus: [
        { menuName: "カット", price: 4950, durationMinutes: 60 },
        { menuName: "カラー", price: 6600, durationMinutes: 90 },
        { menuName: "トリートメント", price: 3300, durationMinutes: 30 },
      ],
      salonName: "ヘアサロン テスト",
      myPageUrl: MY_PAGE_URL,
    });
    expect(text).toContain("\nメニュー: カット + カラー + トリートメント\n");
    expect(text).toContain("\n合計: ¥14,850(約180分)\n");
  });

  it("店名が空文字(空白だけを含む)なら店名の行を出さず、URLで終わる", () => {
    for (const salonName of ["", "  "]) {
      const text = buildBookingConfirmationText({
        kind: "new",
        ...reservation,
        salonName,
        myPageUrl: MY_PAGE_URL,
      });
      expect(text.endsWith(`\n${MY_PAGE_URL}`)).toBe(true);
    }
  });
});

describe("buildReminderText(前日リマインド)", () => {
  it("設計文書「文面」のとおりの全文になる(合計の行はない)", () => {
    expect(
      buildReminderText({
        ...reservation,
        salonName: "ヘアサロン テスト",
        myPageUrl: MY_PAGE_URL,
      }),
    ).toBe(
      [
        "【明日のご予約】",
        "日時: 7月18日(土)11:00〜",
        "メニュー: カット + カラー",
        "担当: 田中",
        "",
        "ご来店をお待ちしております。",
        "ご都合が変わった場合は「マイ予約」から変更・キャンセルできます。",
        MY_PAGE_URL,
        "ヘアサロン テスト",
      ].join("\n"),
    );
  });

  it("日時はJSTの暦日・時刻で出す(UTCでは前日の予約)", () => {
    const text = buildReminderText({
      ...reservation,
      // JST 2026-07-18(土)8:30
      start: new Date("2026-07-17T23:30:00Z"),
      salonName: "ヘアサロン テスト",
      myPageUrl: MY_PAGE_URL,
    });
    expect(text).toContain("\n日時: 7月18日(土)8:30〜\n");
  });

  it("店名が空文字なら店名の行を出さず、URLで終わる", () => {
    const text = buildReminderText({
      ...reservation,
      salonName: "",
      myPageUrl: MY_PAGE_URL,
    });
    expect(text.endsWith(`\n${MY_PAGE_URL}`)).toBe(true);
  });
});

describe("CONFIRMATION_TRIGGER_TEXTS(客が送る定型文)", () => {
  it("新規は「予約を確定しました」、変更は「予約を変更しました」", () => {
    expect(CONFIRMATION_TRIGGER_TEXTS).toEqual({
      new: "予約を確定しました",
      change: "予約を変更しました",
    });
  });
});

describe("isConfirmationTrigger(定型文の判定)", () => {
  it("定型文と完全一致すれば種類を返す", () => {
    expect(isConfirmationTrigger("予約を確定しました")).toBe("new");
    expect(isConfirmationTrigger("予約を変更しました")).toBe("change");
  });

  it("前後の空白・改行・全角スペースは許す", () => {
    expect(isConfirmationTrigger("  予約を確定しました\n")).toBe("new");
    expect(isConfirmationTrigger("\n予約を変更しました\t")).toBe("change");
    expect(isConfirmationTrigger("　予約を確定しました　")).toBe("new");
  });

  it("言い回しが違う・前後に文が付く・途中に空白があるものは該当なし", () => {
    for (const text of [
      "予約を確定しました!",
      "予約を確定しました。",
      "予約を確定しましたか?",
      "さっき予約を確定しました",
      "予約を 確定しました",
      "予約をキャンセルしました",
      "",
      "   ",
    ]) {
      expect(isConfirmationTrigger(text)).toBeNull();
    }
  });
});
