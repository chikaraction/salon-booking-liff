import { describe, expect, it } from "vitest";

import { staffColor } from "./staff-colors";

// 仕様: docs/milestone-4c-plan.md「スタッフ色と休憩」。1人目はテーマ色、
// 2人目はニュートラル、3人目以降は循環させず全員 staff-3 の色
describe("staffColor(スタッフの表示順から色分けを決める)", () => {
  it("0 番目(1人目)は staff-1 の色(凡例・帯・下地)", () => {
    expect(staffColor(0)).toEqual({
      legend: "bg-staff-1",
      card: "border-l-staff-1 bg-staff-1-surface text-foreground",
    });
  });

  it("1 番目(2人目)は staff-2 の色", () => {
    expect(staffColor(1)).toEqual({
      legend: "bg-staff-2",
      card: "border-l-staff-2 bg-staff-2-surface text-foreground",
    });
  });

  it("2 番目(3人目)は staff-3 の色", () => {
    expect(staffColor(2)).toEqual({
      legend: "bg-staff-3",
      card: "border-l-staff-3 bg-staff-3-surface text-foreground",
    });
  });

  it("3 番目以降は循環せず、すべて 3人目と同じ色", () => {
    expect(staffColor(3)).toEqual(staffColor(2));
    expect(staffColor(4)).toEqual(staffColor(2));
    expect(staffColor(10)).toEqual(staffColor(2));
  });
});
