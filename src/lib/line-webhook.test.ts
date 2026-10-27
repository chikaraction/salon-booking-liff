import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECENT_RESERVATION_WINDOW_MINUTES,
  pickConfirmationEvents,
  pickRecentReservation,
  verifyLineSignature,
} from "./line-webhook";
import type { ConfirmationKind } from "./line-messages";

/** 公式ドキュメント「署名を検証する」の Node.js の例と同じ方法で署名を作る */
function officialSignature(body: string, channelSecret: string): string {
  return createHmac("SHA256", channelSecret).update(body).digest("base64");
}

describe("verifyLineSignature(Webhook の署名検証)", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const body =
    '{"destination":"U0123","events":[{"type":"message","message":{"type":"text","id":"1","text":"予約を確定しました"}}]}';

  it("本文をチャネルシークレットで HMAC-SHA256 した base64 と一致すれば true", async () => {
    await expect(
      verifyLineSignature(body, officialSignature(body, secret), secret),
    ).resolves.toBe(true);
  });

  it("疎通確認の空の events でも正しい署名なら true", async () => {
    const ping = '{"destination":"U0123","events":[]}';
    await expect(
      verifyLineSignature(ping, officialSignature(ping, secret), secret),
    ).resolves.toBe(true);
  });

  it("署名が1文字違えば false", async () => {
    const signature = officialSignature(body, secret);
    const tampered = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    await expect(verifyLineSignature(body, tampered, secret)).resolves.toBe(
      false,
    );
  });

  it("本文が1文字違えば false(改ざん)", async () => {
    const signature = officialSignature(body, secret);
    const tamperedBody = body.replace("確定", "変更");
    await expect(
      verifyLineSignature(tamperedBody, signature, secret),
    ).resolves.toBe(false);
  });

  it("別のチャネルシークレットで作った署名なら false", async () => {
    const signature = officialSignature(body, "another-channel-secret");
    await expect(verifyLineSignature(body, signature, secret)).resolves.toBe(
      false,
    );
  });

  it("署名が空文字なら false", async () => {
    await expect(verifyLineSignature(body, "", secret)).resolves.toBe(false);
  });

  it("署名が base64 として不正なら例外にせず false", async () => {
    await expect(
      verifyLineSignature(body, "!!!not-base64!!!", secret),
    ).resolves.toBe(false);
    await expect(verifyLineSignature(body, "abc", secret)).resolves.toBe(false);
  });

  it("チャネルシークレットが空文字なら例外にせず false", async () => {
    await expect(
      verifyLineSignature(body, officialSignature(body, secret), ""),
    ).resolves.toBe(false);
  });

  describe("検証の途中で例外が起きた場合(安全側に倒す)", () => {
    // 正しい署名を渡し、例外さえ起きなければ true になる状況で確かめる
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("crypto.subtle.verify が例外を投げても、例外を外に出さず false", async () => {
      const verify = vi
        .spyOn(globalThis.crypto.subtle, "verify")
        .mockRejectedValue(new Error("verify failed"));
      await expect(
        verifyLineSignature(body, officialSignature(body, secret), secret),
      ).resolves.toBe(false);
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it("base64 の形を確かめたあとの atob が例外を投げても、例外を外に出さず false", async () => {
      const atobSpy = vi.spyOn(globalThis, "atob").mockImplementation(() => {
        throw new Error("atob failed");
      });
      await expect(
        verifyLineSignature(body, officialSignature(body, secret), secret),
      ).resolves.toBe(false);
      expect(atobSpy).toHaveBeenCalledTimes(1);
    });

    it("モックを戻したあとは、正しい署名がふたたび true になる(他のテストに影響しない)", async () => {
      await expect(
        verifyLineSignature(body, officialSignature(body, secret), secret),
      ).resolves.toBe(true);
    });
  });
});

describe("pickConfirmationEvents(Webhook 本文から定型文のイベントを選ぶ)", () => {
  // 定型文の判定は line-messages.ts の isConfirmationTrigger を渡す想定。ここでは固定の表で代用する
  const classify = (text: string): ConfirmationKind | null => {
    if (text === "予約を確定しました") return "new";
    if (text === "予約を変更しました") return "change";
    return null;
  };

  /** 公式リファレンスの例と同じ形の、1対1トークのテキストメッセージイベント */
  function textEvent(text: string, overrides: Record<string, unknown> = {}) {
    return {
      type: "message",
      message: { type: "text", id: "14353798921116", text },
      timestamp: 1625665242211,
      source: { type: "user", userId: "U-customer-1" },
      replyToken: "reply-token-1",
      mode: "active",
      webhookEventId: "01FZ74A0TDDPYRVKNK77XKC3ZR",
      deliveryContext: { isRedelivery: false },
      ...overrides,
    };
  }

  it("1対1トークの定型文テキストを { replyToken, userId, kind } にする", () => {
    const payload = {
      destination: "U0123",
      events: [
        textEvent("予約を確定しました"),
        textEvent("予約を変更しました", {
          replyToken: "reply-token-2",
          source: { type: "user", userId: "U-customer-2" },
        }),
      ],
    };
    expect(pickConfirmationEvents(payload, classify)).toEqual([
      { replyToken: "reply-token-1", userId: "U-customer-1", kind: "new" },
      { replyToken: "reply-token-2", userId: "U-customer-2", kind: "change" },
    ]);
  });

  it("定型文でないテキスト(ふだんのチャット)は捨てる", () => {
    const payload = { events: [textEvent("こんにちは")] };
    expect(pickConfirmationEvents(payload, classify)).toEqual([]);
  });

  it("判定関数にはメッセージのテキストをそのまま渡す", () => {
    const received: string[] = [];
    pickConfirmationEvents(
      { events: [textEvent(" 予約を確定しました\n")] },
      (text) => {
        received.push(text);
        return null;
      },
    );
    expect(received).toEqual([" 予約を確定しました\n"]);
  });

  it("再送されたイベント(deliveryContext.isRedelivery が true)は捨てる", () => {
    const payload = {
      events: [
        textEvent("予約を確定しました", {
          deliveryContext: { isRedelivery: true },
        }),
      ],
    };
    expect(pickConfirmationEvents(payload, classify)).toEqual([]);
  });

  it("deliveryContext が無いイベントは再送ではないとみなして拾う", () => {
    const event: Record<string, unknown> = textEvent("予約を確定しました");
    delete event.deliveryContext;
    expect(pickConfirmationEvents({ events: [event] }, classify)).toEqual([
      { replyToken: "reply-token-1", userId: "U-customer-1", kind: "new" },
    ]);
  });

  it("グループトーク・複数人トークからのメッセージは捨てる", () => {
    const payload = {
      events: [
        textEvent("予約を確定しました", {
          source: { type: "group", groupId: "C1", userId: "U-customer-1" },
        }),
        textEvent("予約を確定しました", {
          source: { type: "room", roomId: "R1", userId: "U-customer-1" },
        }),
      ],
    };
    expect(pickConfirmationEvents(payload, classify)).toEqual([]);
  });

  it("テキスト以外のメッセージ(スタンプ等)は捨てる", () => {
    const payload = {
      events: [
        textEvent("", {
          message: {
            type: "sticker",
            id: "1",
            packageId: "446",
            stickerId: "1988",
          },
        }),
      ],
    };
    expect(pickConfirmationEvents(payload, classify)).toEqual([]);
  });

  it("メッセージイベント以外(フォロー・編集イベント等)は捨てる", () => {
    const payload = {
      events: [
        {
          type: "follow",
          timestamp: 1625665242214,
          source: { type: "user", userId: "U-customer-1" },
          replyToken: "reply-token-1",
          mode: "active",
          webhookEventId: "01FZ74ASS536FW97EX38NKCZQK",
          deliveryContext: { isRedelivery: false },
        },
        textEvent("予約を確定しました", { type: "messageEdited" }),
      ],
    };
    expect(pickConfirmationEvents(payload, classify)).toEqual([]);
  });

  it("応答トークンの無いイベント(チャネルが standby のとき)は捨てる", () => {
    const event: Record<string, unknown> = textEvent("予約を確定しました", {
      mode: "standby",
    });
    delete event.replyToken;
    expect(pickConfirmationEvents({ events: [event] }, classify)).toEqual([]);
  });

  it("疎通確認の空の events は空配列", () => {
    expect(
      pickConfirmationEvents({ destination: "U0123", events: [] }, classify),
    ).toEqual([]);
  });

  it("想定外の形の要素は例外にせず捨て、正しい要素だけ拾う", () => {
    const payload = {
      events: [
        null,
        "message",
        42,
        {},
        textEvent("予約を確定しました", { message: null }),
        textEvent("予約を確定しました", { message: { type: "text", text: 1 } }),
        textEvent("予約を確定しました", { source: null }),
        textEvent("予約を確定しました", { source: { type: "user" } }),
        textEvent("予約を確定しました", {
          source: { type: "user", userId: "" },
        }),
        textEvent("予約を確定しました", { replyToken: "" }),
        textEvent("予約を確定しました", { replyToken: 123 }),
        textEvent("予約を確定しました", { deliveryContext: "redelivery" }),
        textEvent("予約を確定しました"),
      ],
    };
    expect(pickConfirmationEvents(payload, classify)).toEqual([
      { replyToken: "reply-token-1", userId: "U-customer-1", kind: "new" },
    ]);
  });

  it("本文そのものが想定外の形(null・配列・events が配列でない)なら空配列", () => {
    expect(pickConfirmationEvents(null, classify)).toEqual([]);
    expect(pickConfirmationEvents(undefined, classify)).toEqual([]);
    expect(pickConfirmationEvents("text", classify)).toEqual([]);
    expect(
      pickConfirmationEvents([textEvent("予約を確定しました")], classify),
    ).toEqual([]);
    expect(pickConfirmationEvents({ events: {} }, classify)).toEqual([]);
    expect(pickConfirmationEvents({}, classify)).toEqual([]);
  });
});

describe("pickRecentReservation(応答の対象になる直近の予約)", () => {
  const now = new Date("2026-10-22T03:00:00Z");
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * 60 * 1000);

  it("対象にする時間は作成から10分", () => {
    expect(RECENT_RESERVATION_WINDOW_MINUTES).toBe(10);
  });

  it("10分以内の確定済みの予約のうち、作成が最新の1件を返す", () => {
    const reservations = [
      {
        id: "r1",
        createdAt: minutesAgo(8),
        status: "confirmed",
        kind: "booking",
      },
      {
        id: "r2",
        createdAt: minutesAgo(1),
        status: "confirmed",
        kind: "booking",
      },
      {
        id: "r3",
        createdAt: minutesAgo(5),
        status: "confirmed",
        kind: "booking",
      },
    ];
    expect(pickRecentReservation(reservations, now)?.id).toBe("r2");
  });

  it("ちょうど10分前に作成された予約は対象", () => {
    const reservations = [
      {
        id: "r1",
        createdAt: minutesAgo(10),
        status: "confirmed",
        kind: "booking",
      },
    ];
    expect(pickRecentReservation(reservations, now)?.id).toBe("r1");
  });

  it("10分より前に作成された予約は対象外で null", () => {
    const reservations = [
      {
        id: "r1",
        createdAt: new Date(minutesAgo(10).getTime() - 1),
        status: "confirmed",
        kind: "booking",
      },
    ];
    expect(pickRecentReservation(reservations, now)).toBeNull();
  });

  it("ちょうど now に作成された予約は対象、now より後(時計のずれ)は対象外", () => {
    expect(
      pickRecentReservation(
        [{ id: "r1", createdAt: now, status: "confirmed", kind: "booking" }],
        now,
      )?.id,
    ).toBe("r1");
    expect(
      pickRecentReservation(
        [
          {
            id: "r1",
            createdAt: new Date(now.getTime() + 1),
            status: "confirmed",
            kind: "booking",
          },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("キャンセル済みの予約は、より新しくても選ばない", () => {
    const reservations = [
      {
        id: "r1",
        createdAt: minutesAgo(5),
        status: "confirmed",
        kind: "booking",
      },
      {
        id: "r2",
        createdAt: minutesAgo(1),
        status: "cancelled",
        kind: "booking",
      },
    ];
    expect(pickRecentReservation(reservations, now)?.id).toBe("r1");
  });

  it("ブロック(kind = block)は選ばない", () => {
    const reservations = [
      {
        id: "r1",
        createdAt: minutesAgo(1),
        status: "confirmed",
        kind: "block",
      },
    ];
    expect(pickRecentReservation(reservations, now)).toBeNull();
  });

  it("予約が1件も無ければ null", () => {
    expect(pickRecentReservation([], now)).toBeNull();
  });

  it("入力の要素をそのまま返す(他のプロパティも保つ)", () => {
    const reservation = {
      id: "r1",
      createdAt: minutesAgo(2),
      status: "confirmed",
      kind: "booking",
      staffName: "田中",
    };
    expect(pickRecentReservation([reservation], now)).toBe(reservation);
  });
});
