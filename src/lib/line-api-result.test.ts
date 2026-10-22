import { describe, expect, it } from "vitest";
import { interpretLineSendResponse } from "./line-api-result";

describe("interpretLineSendResponse(LINE の送信 API の応答の解釈)", () => {
  it("200 は送信の受理として ok(リトライキーの重複ではない)", () => {
    expect(
      interpretLineSendResponse(200, {
        sentMessages: [{ id: "461230966842064897" }],
      }),
    ).toEqual({ ok: true, alreadyAccepted: false });
  });

  it("200番台はすべて受理として扱う", () => {
    expect(interpretLineSendResponse(202, null)).toEqual({
      ok: true,
      alreadyAccepted: false,
    });
  });

  it("409 は同じリトライキーが受理済み = 送信済みとして ok・alreadyAccepted で区別する", () => {
    expect(
      interpretLineSendResponse(409, {
        message: "The retry key is already accepted",
        sentMessages: [{ id: "461230966842064897" }],
      }),
    ).toEqual({ ok: true, alreadyAccepted: true });
  });

  it("400 はエラー。本文の message を返す", () => {
    expect(
      interpretLineSendResponse(400, { message: "Invalid reply token" }),
    ).toEqual({ ok: false, status: 400, message: "Invalid reply token" });
  });

  it("details があれば message の後ろに property と詳細を添える", () => {
    expect(
      interpretLineSendResponse(400, {
        message: "The request body has 2 error(s)",
        details: [
          {
            message: "May not be empty",
            property: "messages[0].text",
          },
          { message: "Must be one of the following values: [text]" },
        ],
      }),
    ).toEqual({
      ok: false,
      status: 400,
      message:
        "The request body has 2 error(s)(messages[0].text: May not be empty / Must be one of the following values: [text])",
    });
  });

  it("429(無料通数の超過など)はエラー", () => {
    expect(
      interpretLineSendResponse(429, {
        message: "You have reached your monthly limit.",
      }),
    ).toEqual({
      ok: false,
      status: 429,
      message: "You have reached your monthly limit.",
    });
  });

  it("本文が JSON でない・message が無いときは HTTP ステータスを message にする", () => {
    expect(interpretLineSendResponse(500, null)).toEqual({
      ok: false,
      status: 500,
      message: "HTTP 500",
    });
    expect(interpretLineSendResponse(401, { error: "x" })).toEqual({
      ok: false,
      status: 401,
      message: "HTTP 401",
    });
  });

  it("details の形が想定外の要素は無視する", () => {
    expect(
      interpretLineSendResponse(400, {
        message: "Bad",
        details: ["x", null, { property: "to" }],
      }),
    ).toEqual({ ok: false, status: 400, message: "Bad" });
  });
});
