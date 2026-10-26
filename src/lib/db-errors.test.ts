import { describe, expect, it } from "vitest";

import {
  hasSqlState,
  isReservationLimitError,
  isRpcRaisedError,
  isSlotTakenError,
} from "./db-errors";

describe("hasSqlState: SQLSTATE の一致判定", () => {
  it("code が一致する文字列の object なら true", () => {
    expect(hasSqlState({ code: "23P01" }, "23P01")).toBe(true);
  });

  it("code が違う object なら false", () => {
    expect(hasSqlState({ code: "23505" }, "23P01")).toBe(false);
  });

  it("code を持たない object なら false", () => {
    expect(hasSqlState({}, "23P01")).toBe(false);
    expect(hasSqlState({ message: "23P01" }, "23P01")).toBe(false);
  });

  it("null / undefined / 文字列 / 数値なら false", () => {
    expect(hasSqlState(null, "23P01")).toBe(false);
    expect(hasSqlState(undefined, "23P01")).toBe(false);
    expect(hasSqlState("23P01", "23P01")).toBe(false);
    expect(hasSqlState(23505, "23505")).toBe(false);
  });

  it("code が文字列でない object なら false", () => {
    expect(hasSqlState({ code: 23505 }, "23505")).toBe(false);
    expect(hasSqlState({ code: null }, "23P01")).toBe(false);
    expect(hasSqlState({ code: ["23P01"] }, "23P01")).toBe(false);
  });

  it("Error インスタンスに code を付けたものも判定できる", () => {
    const error = Object.assign(new Error("conflict"), { code: "23P01" });
    expect(hasSqlState(error, "23P01")).toBe(true);
    expect(hasSqlState(error, "P0001")).toBe(false);
    expect(hasSqlState(new Error("network"), "23P01")).toBe(false);
  });
});

describe("isRpcRaisedError: RPCが raise した業務エラーの判定", () => {
  it("SQLSTATE P0001 のエラーをRPCの業務エラーと判定する", () => {
    expect(isRpcRaisedError({ code: "P0001" })).toBe(true);
  });

  it("それ以外のエラーはRPCの業務エラーではない", () => {
    expect(isRpcRaisedError({ code: "23P01" })).toBe(false);
    expect(isRpcRaisedError({ code: "R0001" })).toBe(false);
    expect(isRpcRaisedError({ code: "42501" })).toBe(false); // 権限なし(forbidden)
    expect(isRpcRaisedError(null)).toBe(false);
    expect(isRpcRaisedError(new Error("network"))).toBe(false);
  });
});

describe("isSlotTakenError: EXCLUDE制約違反の判定", () => {
  it("SQLSTATE 23P01 のエラーを枠埋まりと判定する(ADR-004)", () => {
    expect(isSlotTakenError({ code: "23P01" })).toBe(true);
  });

  it("それ以外のエラーは枠埋まりではない", () => {
    expect(isSlotTakenError({ code: "P0001" })).toBe(false);
    expect(isSlotTakenError(null)).toBe(false);
    expect(isSlotTakenError(new Error("network"))).toBe(false);
  });
});

describe("isReservationLimitError: 1人あたりの予約上限超過の判定", () => {
  it("SQLSTATE R0001 のエラーを予約上限超過と判定する", () => {
    expect(isReservationLimitError({ code: "R0001" })).toBe(true);
  });

  it("それ以外のエラーは予約上限超過ではない", () => {
    expect(isReservationLimitError({ code: "23P01" })).toBe(false);
    expect(isReservationLimitError({ code: "P0001" })).toBe(false);
    expect(isReservationLimitError(null)).toBe(false);
    expect(isReservationLimitError(new Error("network"))).toBe(false);
  });
});
